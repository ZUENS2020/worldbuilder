"""Simulation API routes — P1: create/get + manual single-step + tick & memory reads."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.models import Simulation, SimTick, AgentMemory, Project
from app.services.simulation import run_tick, DEFAULT_CONFIG
from app.services import belief
from app.services.memory import get_memory_block
from app.services import st_writeback
from app.services.st_writeback import resolve_entity_id, merge_writeback_config

router = APIRouter(prefix="/api/projects/{project_id}/simulations", tags=["simulations"])


# ── schemas ──────────────────────────────────────────────────────

class SimulationCreate(BaseModel):
    name: str = ""
    driver_mode: str = "hybrid"     # hybrid | full_llm
    config: dict | None = None


class SimulationOut(BaseModel):
    id: str
    project_id: str
    name: str
    status: str
    driver_mode: str
    current_tick: int
    config: dict

    model_config = {"from_attributes": True}


def _serialize_tick(t: SimTick) -> dict:
    return {
        "id": t.id, "tick": t.tick,
        "interactions": t.interactions, "mutations": t.mutations,
        "snapshot": t.snapshot, "metrics": t.metrics,
    }


# ── CRUD ─────────────────────────────────────────────────────────

@router.post("", response_model=SimulationOut)
async def create_simulation(project_id: str, data: SimulationCreate, db: AsyncSession = Depends(get_db)):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    config = {**DEFAULT_CONFIG, **(data.config or {})}
    sim = Simulation(
        id=str(uuid.uuid4()),
        project_id=project_id,
        name=data.name or "模拟",
        status="idle",
        driver_mode=data.driver_mode,
        current_tick=0,
        config=config,
    )
    db.add(sim)
    await db.commit()
    await db.refresh(sim)
    return sim


@router.get("", response_model=list[SimulationOut])
async def list_simulations(project_id: str, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Simulation).where(Simulation.project_id == project_id)
        .order_by(Simulation.created_at.desc())
    )).scalars().all()
    return rows


@router.get("/{sim_id}", response_model=SimulationOut)
async def get_simulation(project_id: str, sim_id: str, db: AsyncSession = Depends(get_db)):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    return sim


# ── stepping ─────────────────────────────────────────────────────

@router.post("/{sim_id}/step")
async def step_simulation(project_id: str, sim_id: str, db: AsyncSession = Depends(get_db)):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    simtick = await run_tick(db, sim)
    return {"simulation": SimulationOut.model_validate(sim).model_dump(), "tick": _serialize_tick(simtick)}


# ── reads ────────────────────────────────────────────────────────

@router.get("/{sim_id}/ticks")
async def list_ticks(
    project_id: str, sim_id: str,
    from_: int = Query(0, alias="from"), to: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SimTick).where(SimTick.simulation_id == sim_id).where(SimTick.tick >= from_)
    if to is not None:
        stmt = stmt.where(SimTick.tick <= to)
    rows = (await db.execute(stmt.order_by(SimTick.tick))).scalars().all()
    return [_serialize_tick(t) for t in rows]


@router.get("/{sim_id}/ticks/{tick}")
async def get_tick(project_id: str, sim_id: str, tick: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(SimTick).where(SimTick.simulation_id == sim_id).where(SimTick.tick == tick)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Tick not found")
    return _serialize_tick(row)


@router.get("/{sim_id}/beliefs")
async def get_beliefs(
    project_id: str, sim_id: str, observer: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """One observer's beliefs paired with canonical truth, for the belief-vs-truth
    comparison view. Diffs (stale / wrong / unknown) are computed on the frontend."""
    observer_id = resolve_entity_id(project_id, observer) or observer
    return await belief.get_belief_map(db, project_id, observer_id)


@router.get("/{sim_id}/memory")
async def get_memory(
    project_id: str, sim_id: str, entity: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Raw memory stream for one agent (debug / inspector). Includes compacted rows."""
    entity_id = resolve_entity_id(project_id, entity) or entity
    rows = (await db.execute(
        select(AgentMemory)
        .where(AgentMemory.simulation_id == sim_id)
        .where(AgentMemory.entity_id == entity_id)
        .order_by(AgentMemory.tick, AgentMemory.created_at)
    )).scalars().all()
    return [
        {
            "id": m.id, "tick": m.tick, "kind": m.kind, "content": m.content,
            "participants": m.participants, "salience": m.salience,
            "compacted_into": (m.properties or {}).get("compacted_into"),
        }
        for m in rows
    ]


@router.get("/{sim_id}/memory-block")
async def get_memory_block_route(
    project_id: str, sim_id: str,
    entity: str = Query(...),
    recent_k: int = Query(8, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Formatted memory block for ST plugin injection."""
    entity_id = resolve_entity_id(project_id, entity)
    if not entity_id:
        raise HTTPException(400, f"Unknown entity: {entity}")
    block = await get_memory_block(
        db, simulation_id=sim_id, entity_id=entity_id, recent_k=recent_k,
    )
    return {"block": block, "token_count": len(block) // 2 if block else 0}


# ── ST writeback queue ───────────────────────────────────────────

class WritebackQueueIn(BaseModel):
    observer: str
    partner: str | None = None
    user_message: str = ""
    assistant_message: str = ""
    source_meta: dict | None = None


class WritebackPreviewIn(BaseModel):
    ids: list[str]
    depth: str = "mechanical"  # mechanical | llm_oracle


class WritebackApplyIn(BaseModel):
    ids: list[str]
    depth: str | None = None


class WritebackConfigPatch(BaseModel):
    writeback_trigger: str | None = None
    writeback_every_n: int | None = None
    writeback_depth: str | None = None
    st_source_label: str | None = None


@router.post("/{sim_id}/st-writeback/queue")
async def queue_writeback(
    project_id: str, sim_id: str, data: WritebackQueueIn,
    db: AsyncSession = Depends(get_db),
):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    row = await st_writeback.enqueue(
        db, sim,
        observer_name=data.observer,
        partner_name=data.partner,
        user_message=data.user_message,
        assistant_message=data.assistant_message,
        source_meta=data.source_meta,
    )
    await db.commit()
    await db.refresh(row)
    count = await st_writeback.pending_count(db, sim_id)
    return {**st_writeback._serialize_item(row), "pending_count": count}


@router.get("/{sim_id}/st-writeback")
async def list_writeback(
    project_id: str, sim_id: str,
    status: str = Query("pending"),
    limit: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    items = await st_writeback.list_items(db, sim_id, status=status or None, limit=limit)
    pending_count = await st_writeback.pending_count(db, sim_id)
    return {"items": items, "pending_count": pending_count}


@router.post("/{sim_id}/st-writeback/preview")
async def preview_writeback(
    project_id: str, sim_id: str, data: WritebackPreviewIn,
    db: AsyncSession = Depends(get_db),
):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    result = await st_writeback.preview_items(db, sim, data.ids, data.depth)
    await db.commit()
    return result


@router.post("/{sim_id}/st-writeback/apply")
async def apply_writeback(
    project_id: str, sim_id: str, data: WritebackApplyIn,
    db: AsyncSession = Depends(get_db),
):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    depth = data.depth or _cfg_writeback(sim, "writeback_depth") or "mechanical"
    if (_cfg_writeback(sim, "writeback_trigger") == "auto_llm"):
        depth = "llm_oracle"
    result = await st_writeback.apply_items(db, sim, data.ids, depth)
    await db.commit()
    await db.refresh(sim)
    return {**result, "simulation": SimulationOut.model_validate(sim).model_dump()}


@router.delete("/{sim_id}/st-writeback/{item_id}")
async def discard_writeback(
    project_id: str, sim_id: str, item_id: str,
    db: AsyncSession = Depends(get_db),
):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    ok = await st_writeback.delete_item(db, sim_id, item_id)
    if not ok:
        raise HTTPException(404, "Pending item not found")
    await db.commit()
    return {"ok": True}


@router.patch("/{sim_id}/st-writeback/config")
async def patch_writeback_config(
    project_id: str, sim_id: str, data: WritebackConfigPatch,
    db: AsyncSession = Depends(get_db),
):
    sim = await db.get(Simulation, sim_id)
    if not sim or sim.project_id != project_id:
        raise HTTPException(404, "Simulation not found")
    sim.config = merge_writeback_config(sim.config, data.model_dump(exclude_none=True))
    await db.commit()
    await db.refresh(sim)
    return SimulationOut.model_validate(sim)


def _cfg_writeback(sim: Simulation, key: str):
    return (sim.config or {}).get(key, DEFAULT_CONFIG.get(key))
