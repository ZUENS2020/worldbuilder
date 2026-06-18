"""SillyTavern chat → simulation writeback queue (enqueue, preview, apply)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.graph.engine import graph_engine
from app.models.models import Entity, Simulation, SimTick, StWritebackQueue
from app.services import ai_service, belief
from app.services.memory import append_memory
from app.services.simulation import (
    DEFAULT_CONFIG,
    _apply_mutations,
    _build_snapshot,
    _cfg,
    _name_index,
)


def resolve_entity_id(project_id: str, token: str) -> str | None:
    token = (token or "").strip()
    if not token:
        return None
    if token in graph_engine.entities:
        e = graph_engine.entities[token]
        return token if e.project_id == project_id else None
    for eid, e in graph_engine.entities.items():
        if e.name == token and e.project_id == project_id:
            return eid
    return None


def _serialize_item(row: StWritebackQueue) -> dict:
    obs = graph_engine.entities.get(row.observer_id) if row.observer_id else None
    par = graph_engine.entities.get(row.partner_id) if row.partner_id else None
    return {
        "id": row.id,
        "status": row.status,
        "round_index": row.round_index,
        "observer_id": row.observer_id,
        "observer_name": obs.name if obs else None,
        "partner_id": row.partner_id,
        "partner_name": par.name if par else None,
        "user_message": row.user_message or "",
        "assistant_message": row.assistant_message or "",
        "source_meta": row.source_meta or {},
        "preview": row.preview or {},
        "result": row.result or {},
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "applied_at": row.applied_at.isoformat() if row.applied_at else None,
    }


def _scene_from_items(items: list[StWritebackQueue]) -> list[dict]:
    scenes = []
    for row in items:
        obs = graph_engine.entities.get(row.observer_id) if row.observer_id else None
        par = graph_engine.entities.get(row.partner_id) if row.partner_id else None
        names = [n for n in (obs.name if obs else None, par.name if par else None) if n]
        narrative = (
            f"用户：{row.user_message or ''}\n"
            f"{obs.name if obs else '角色'}：{row.assistant_message or ''}"
        ).strip()
        scenes.append({
            "participants": names or ["?"],
            "participant_ids": [row.observer_id, row.partner_id],
            "narrative": narrative,
            "intents": [],
        })
    return scenes


async def enqueue(
    db: AsyncSession,
    sim: Simulation,
    *,
    observer_name: str,
    partner_name: str | None,
    user_message: str,
    assistant_message: str,
    source_meta: dict | None = None,
) -> StWritebackQueue:
    pid = sim.project_id
    observer_id = resolve_entity_id(pid, observer_name)
    partner_id = resolve_entity_id(pid, partner_name) if partner_name else None

    max_round = (await db.execute(
        select(func.max(StWritebackQueue.round_index)).where(
            StWritebackQueue.simulation_id == sim.id
        )
    )).scalar()
    round_index = (max_round or 0) + 1

    row = StWritebackQueue(
        id=str(uuid.uuid4()),
        project_id=pid,
        simulation_id=sim.id,
        status="pending",
        round_index=round_index,
        observer_id=observer_id,
        partner_id=partner_id,
        user_message=user_message or "",
        assistant_message=assistant_message or "",
        source_meta=source_meta or {},
    )
    db.add(row)
    await db.flush()
    await maybe_auto_apply(db, sim)
    return row


async def list_items(
    db: AsyncSession, sim_id: str, *, status: str | None = "pending", limit: int = 100,
) -> list[dict]:
    stmt = select(StWritebackQueue).where(StWritebackQueue.simulation_id == sim_id)
    if status:
        stmt = stmt.where(StWritebackQueue.status == status)
    stmt = stmt.order_by(StWritebackQueue.round_index.desc()).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize_item(r) for r in rows]


async def delete_item(db: AsyncSession, sim_id: str, item_id: str) -> bool:
    row = await db.get(StWritebackQueue, item_id)
    if not row or row.simulation_id != sim_id or row.status != "pending":
        return False
    row.status = "rejected"
    await db.flush()
    return True


async def preview_items(
    db: AsyncSession, sim: Simulation, item_ids: list[str], depth: str,
) -> dict:
    rows = (await db.execute(
        select(StWritebackQueue).where(
            StWritebackQueue.simulation_id == sim.id,
            StWritebackQueue.id.in_(item_ids),
            StWritebackQueue.status == "pending",
        )
    )).scalars().all()
    if not rows:
        return {"items": [], "depth": depth}

    previews = []
    if depth == "llm_oracle":
        catalog = [
            {"name": e.name, "type": e.type}
            for eid in graph_engine.project_entities.get(sim.project_id, set())
            if (e := graph_engine.entities.get(eid))
        ]
        scenes = _scene_from_items(rows)
        config = sim.config or {}
        verdict = await ai_service.ai_adjudicate(
            scenes, catalog,
            allow_new_entities=bool(_cfg(sim, "allow_new_entities")),
            generate_events=False,
            config=config,
        )
        batch_preview = {
            "mutations": verdict.get("mutations", []),
            "new_entities": verdict.get("new_entities", []),
        }
        for row in rows:
            mem = _mechanical_memory_preview(row)
            pv = {**batch_preview, "memory": mem}
            row.preview = pv
            previews.append({"id": row.id, **pv})
    else:
        for row in rows:
            pv = {"memory": _mechanical_memory_preview(row), "belief_sync": _belief_sync_preview(row)}
            row.preview = pv
            previews.append({"id": row.id, **pv})

    await db.flush()
    return {"items": previews, "depth": depth}


def _mechanical_memory_preview(row: StWritebackQueue) -> list[str]:
    obs = graph_engine.entities.get(row.observer_id) if row.observer_id else None
    par = graph_engine.entities.get(row.partner_id) if row.partner_id else None
    who = "、".join(n for n in (par.name if par else None,) if n)
    text = f"用户：{row.user_message}\n{obs.name if obs else '角色'}：{row.assistant_message}"
    prefix = f"(ST r{row.round_index}" + (f", 与{who}" if who else "") + ")"
    return [f"{prefix} {text.strip()}"]


def _belief_sync_preview(row: StWritebackQueue) -> list[str]:
    pairs = []
    if row.observer_id:
        pairs.append((row.observer_id, row.observer_id))
        if row.partner_id:
            pairs.append((row.observer_id, row.partner_id))
    return [f"{a} perceives {b}" for a, b in pairs]


async def apply_items(
    db: AsyncSession, sim: Simulation, item_ids: list[str], depth: str,
) -> dict:
    rows = (await db.execute(
        select(StWritebackQueue).where(
            StWritebackQueue.simulation_id == sim.id,
            StWritebackQueue.id.in_(item_ids),
            StWritebackQueue.status == "pending",
        ).order_by(StWritebackQueue.round_index)
    )).scalars().all()
    if not rows:
        return {"applied": [], "mutations": []}

    for row in rows:
        row.status = "processing"
    await db.flush()

    tick = (sim.current_tick or 0) + 1
    config = sim.config or {}
    all_mutations: list[dict] = []
    applied_ids: list[str] = []

    try:
        for row in rows:
            mem_ids = await _apply_mechanical_row(db, sim, row, tick)
            row_result: dict = {"memory_ids": mem_ids}

            if depth == "llm_oracle":
                catalog = [
                    {"name": e.name, "type": e.type}
                    for eid in graph_engine.project_entities.get(sim.project_id, set())
                    if (e := graph_engine.entities.get(eid))
                ]
                scenes = _scene_from_items([row])
                verdict = await ai_service.ai_adjudicate(
                    scenes, catalog,
                    allow_new_entities=bool(_cfg(sim, "allow_new_entities")),
                    generate_events=False,
                    config=config,
                )
                muts = await _apply_mutations(
                    db, sim, verdict.get("mutations", []), verdict.get("new_entities", []),
                )
                all_mutations.extend(muts)
                row_result["mutations"] = muts
                await _reconcile_visibility_mutations(db, sim, muts, config)

            row.status = "applied"
            row.applied_at = datetime.now(timezone.utc)
            row.result = row_result
            applied_ids.append(row.id)

        sim.current_tick = tick
        snapshot = await _build_snapshot(db, sim)
        simtick = SimTick(
            id=str(uuid.uuid4()),
            simulation_id=sim.id,
            project_id=sim.project_id,
            tick=tick,
            interactions=[{
                "source": "st_writeback",
                "rounds": [r.round_index for r in rows],
            }],
            mutations=all_mutations,
            snapshot=snapshot,
            metrics={"source": "st_writeback", "depth": depth, "count": len(rows)},
        )
        db.add(simtick)
        await db.flush()
        return {"applied": applied_ids, "mutations": all_mutations, "tick": tick}
    except Exception as e:
        for row in rows:
            if row.status == "processing":
                row.status = "failed"
                row.result = {"error": str(e)}
        await db.flush()
        raise


async def _apply_mechanical_row(
    db: AsyncSession, sim: Simulation, row: StWritebackQueue, tick: int,
) -> list[str]:
    mem_ids: list[str] = []
    if not row.observer_id:
        return mem_ids

    obs = graph_engine.entities.get(row.observer_id)
    par = graph_engine.entities.get(row.partner_id) if row.partner_id else None
    participants = [n for n in (obs.name if obs else None, par.name if par else None) if n]
    content = f"用户：{row.user_message}\n{obs.name if obs else '角色'}：{row.assistant_message}"

    m = await append_memory(
        db,
        project_id=sim.project_id,
        simulation_id=sim.id,
        entity_id=row.observer_id,
        tick=tick,
        content=content.strip(),
        participants=participants,
    )
    mem_ids.append(m.id)

    perceptions: list[tuple[str, str]] = [(row.observer_id, row.observer_id)]
    if row.partner_id:
        perceptions.append((row.observer_id, row.partner_id))
    await belief.sync_beliefs(db, sim, tick, perceptions)
    return mem_ids


async def _reconcile_visibility_mutations(
    db: AsyncSession, sim: Simulation, mutations: list[dict], config: dict,
) -> None:
    name_idx = _name_index(sim.project_id)
    for m in mutations:
        if m.get("op") != "set_prop_visibility" or m.get("level") != "entities":
            continue
        subject = name_idx.get(m.get("entity"))
        key = m.get("key")
        if not subject or not key:
            continue
        truth_val = (subject.properties or {}).get(key)
        if truth_val is None:
            continue
        for observer_id in (m.get("entities") or []):
            if observer_id == subject.id:
                continue
            await belief.reconcile_belief(
                db, sim, observer_id, subject.id, {key: truth_val}, config=config,
            )


async def maybe_auto_apply(db: AsyncSession, sim: Simulation) -> None:
    trigger = _cfg(sim, "writeback_trigger") or "manual"
    if trigger == "manual":
        return

    if trigger == "auto_llm":
        pending = (await db.execute(
            select(StWritebackQueue).where(
                StWritebackQueue.simulation_id == sim.id,
                StWritebackQueue.status == "pending",
            ).order_by(StWritebackQueue.round_index.desc()).limit(1)
        )).scalar_one_or_none()
        if pending:
            await apply_items(db, sim, [pending.id], "llm_oracle")
        return

    if trigger == "every_n_rounds":
        n = int(_cfg(sim, "writeback_every_n") or 3)
        pending = (await db.execute(
            select(StWritebackQueue).where(
                StWritebackQueue.simulation_id == sim.id,
                StWritebackQueue.status == "pending",
            ).order_by(StWritebackQueue.round_index)
        )).scalars().all()
        if len(pending) >= n:
            depth = _cfg(sim, "writeback_depth") or "mechanical"
            ids = [r.id for r in pending[:n]]
            await apply_items(db, sim, ids, depth)


async def pending_count(db: AsyncSession, sim_id: str) -> int:
    return (await db.execute(
        select(func.count()).select_from(StWritebackQueue).where(
            StWritebackQueue.simulation_id == sim_id,
            StWritebackQueue.status == "pending",
        )
    )).scalar() or 0


def merge_writeback_config(config: dict | None, patch: dict) -> dict:
    merged = {**DEFAULT_CONFIG, **(config or {})}
    for k in ("writeback_trigger", "writeback_every_n", "writeback_depth", "st_source_label"):
        if k in patch and patch[k] is not None:
            merged[k] = patch[k]
    return merged
