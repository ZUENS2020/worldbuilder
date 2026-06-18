"""Per-agent cognition (P4) — each agent keeps its own copy of the world.

Beliefs are simulation-scoped (simulation_id) when running the tick engine;
project-level rows (simulation_id IS NULL) remain for manual ST seed without a sim.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Belief, Entity
from app.graph import visibility
from app.graph import engine as engine_mod
from app.graph.engine import graph_engine
from app.graph import worldbook
from app.services import ai_service

# Mutable props for in-scene canonical read (self + partner).
_IN_SCENE_CANONICAL_KEYS = frozenset({"mood", "goal", "occupation"})


def _visible_props(observer_id: str, subject: Entity) -> dict:
    props = visibility.filter_properties(subject, observer_id, graph_engine)
    return {
        k: v for k, v in (props or {}).items()
        if k not in engine_mod._SKIP_PROP_KEYS and v not in (None, "", [], {})
    }


def _visible_relations(observer_id: str, subject_id: str) -> list[dict]:
    out = []
    seen = set()
    for r in graph_engine.adjacency.get(subject_id, []):
        if r.id in seen:
            continue
        seen.add(r.id)
        if not visibility.relation_visible_to(r, observer_id, graph_engine):
            continue
        out.append({
            "source_id": r.source_id, "target_id": r.target_id,
            "type": r.type, "weight": r.weight,
            "description": (r.properties or {}).get("description", ""),
        })
    return out


def _relation_between(observer_id: str, a_id: str, b_id: str) -> dict | None:
    """Canonical visible relation between two entities (either direction)."""
    for r in graph_engine.adjacency.get(a_id, []):
        if {r.source_id, r.target_id} != {a_id, b_id}:
            continue
        if not visibility.relation_visible_to(r, observer_id, graph_engine):
            continue
        return {
            "source_id": r.source_id, "target_id": r.target_id,
            "type": r.type, "weight": r.weight,
            "description": (r.properties or {}).get("description", ""),
        }
    return None


def _format_relation_row(r: dict, observer_id: str) -> dict:
    src = graph_engine.entities.get(r.get("source_id"))
    tgt = graph_engine.entities.get(r.get("target_id"))
    rlabel = engine_mod.RELATION_TYPE_LABELS.get(r.get("type"), r.get("type"))
    return {
        "source_id": r.get("source_id"),
        "target_id": r.get("target_id"),
        "source_name": src.name if src else "?",
        "target_name": tgt.name if tgt else "?",
        "type": r.get("type"),
        "type_label": rlabel,
        "weight": r.get("weight"),
        "description": r.get("description") or "",
        "label": (
            f"{src.name if src else '?'} --[{rlabel}]--> {tgt.name if tgt else '?'}"
            + (f"（{r['description']}）" if r.get("description") else "")
            + (f" [{float(r.get('weight') or 0.5):.2f}]" if r.get("weight") is not None else "")
        ),
    }


async def _get_belief(
    db: AsyncSession, project_id: str, observer_id: str, subject_id: str,
    *, simulation_id: str | None = None,
) -> Belief | None:
    stmt = select(Belief).where(
        Belief.project_id == project_id,
        Belief.observer_id == observer_id,
        Belief.subject_id == subject_id,
    )
    if simulation_id:
        stmt = stmt.where(Belief.simulation_id == simulation_id)
    else:
        stmt = stmt.where(Belief.simulation_id.is_(None))
    return (await db.execute(stmt)).scalar_one_or_none()


async def _upsert_belief(
    db: AsyncSession, project_id: str, observer_id: str, subject_id: str,
    props: dict, relations: list[dict], tick: int,
    *, simulation_id: str | None = None,
) -> Belief:
    row = await _get_belief(
        db, project_id, observer_id, subject_id, simulation_id=simulation_id,
    )
    if row is None:
        row = Belief(
            id=str(uuid.uuid4()), project_id=project_id,
            simulation_id=simulation_id,
            observer_id=observer_id, subject_id=subject_id,
            believed_properties=props, believed_relations=relations,
            as_of_tick=tick, confidence=1.0,
        )
        db.add(row)
    else:
        row.believed_properties = props
        row.believed_relations = relations
        row.as_of_tick = tick
    return row


def _project_characters(project_id: str) -> list[Entity]:
    return [
        e for e in graph_engine.get_project_entities(project_id)
        if e.type == "character"
    ]


async def seed_beliefs_for_project(db: AsyncSession, project_id: str, *, tick: int = 0) -> int:
    """Idempotent belief seed for a project (no Simulation) — ST manual seed."""
    pid = project_id
    existing = (await db.execute(
        select(Belief.id).where(
            Belief.project_id == pid, Belief.simulation_id.is_(None),
        ).limit(1)
    )).first()
    if existing:
        return 0

    created = 0
    all_entities = graph_engine.get_project_entities(pid)
    for observer in _project_characters(pid):
        for subject in all_entities:
            if not visibility.entity_visible_to(subject, observer.id, graph_engine):
                continue
            await _upsert_belief(
                db, pid, observer.id, subject.id,
                _visible_props(observer.id, subject),
                _visible_relations(observer.id, subject.id),
                tick=tick, simulation_id=None,
            )
            created += 1
    await db.flush()
    return created


async def seed_beliefs(db: AsyncSession, sim) -> int:
    """Per-simulation idempotent seed from visibility-filtered truth."""
    sid = sim.id
    pid = sim.project_id
    existing = (await db.execute(
        select(Belief.id).where(Belief.simulation_id == sid).limit(1)
    )).first()
    if existing:
        return 0

    created = 0
    all_entities = graph_engine.get_project_entities(pid)
    for observer in _project_characters(pid):
        for subject in all_entities:
            if not visibility.entity_visible_to(subject, observer.id, graph_engine):
                continue
            await _upsert_belief(
                db, pid, observer.id, subject.id,
                _visible_props(observer.id, subject),
                _visible_relations(observer.id, subject.id),
                tick=0, simulation_id=sid,
            )
            created += 1
    await db.flush()
    return created


async def clear_sim_beliefs(db: AsyncSession, simulation_id: str) -> None:
    await db.execute(delete(Belief).where(Belief.simulation_id == simulation_id))
    await db.flush()


async def refresh_encounter_beliefs(
    db: AsyncSession, sim, tick: int, observer_id: str, partner_id: str,
) -> None:
    """Pre-encounter sync: refresh beliefs for self + partner from visible canonical."""
    perceptions = [
        (observer_id, observer_id),
        (observer_id, partner_id),
        (partner_id, partner_id),
        (partner_id, observer_id),
    ]
    await sync_beliefs(db, sim, tick, perceptions)


async def sync_beliefs(db: AsyncSession, sim, tick: int, perceptions: list[tuple[str, str]]) -> None:
    pid = sim.project_id
    sid = sim.id
    done = set()
    for observer_id, subject_id in perceptions:
        key = (observer_id, subject_id)
        if key in done:
            continue
        done.add(key)
        subject = graph_engine.entities.get(subject_id)
        if not subject:
            continue
        if not visibility.entity_visible_to(subject, observer_id, graph_engine):
            continue
        await _upsert_belief(
            db, pid, observer_id, subject_id,
            _visible_props(observer_id, subject),
            _visible_relations(observer_id, subject_id),
            tick=tick, simulation_id=sid,
        )
    await db.flush()


def _render_belief_block(name: str, type_label: str, props: dict) -> list[str]:
    lines = [f"【{name}（{type_label}）】"]
    lines.extend(engine_mod._format_props(props))
    return lines


def _merge_in_scene_props(
    observer_id: str, subject_id: str, partner_id: str, props: dict,
) -> dict:
    """For self/partner in an encounter, overlay canonical mood/goal/occupation."""
    if subject_id not in (observer_id, partner_id):
        return props
    subject = graph_engine.entities.get(subject_id)
    if not subject:
        return props
    canon = _visible_props(observer_id, subject)
    merged = dict(props)
    for k in _IN_SCENE_CANONICAL_KEYS:
        if k in canon:
            merged[k] = canon[k]
    return merged


def _situation_block(sim, observer_id: str, partner_id: str, recent_k: int) -> str:
    """The 「当前态势」 block — what is happening / just happened.

    This is the piece that was missing and caused the endless-prelude loop: it
    feeds the Actor the world's *current* situation (active pending events) and
    its *immediate aftermath* (recently-resolved event outcomes), so scenes play
    the present and the余波 instead of re-staging the same pre-event mood forever.
    """
    pid = sim.project_id
    sid = sim.id
    cur_tick = sim.current_tick or 0
    window_floor = cur_tick - max(1, int(recent_k or 6))

    pending: list[tuple] = []   # (due_sort, line)
    resolved: list[tuple] = []  # (tick, line)
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event":
            continue
        props = e.properties or {}
        meta = props.get("_sim") if isinstance(props.get("_sim"), dict) else {}
        # Show this sim's events AND user-preset events (no _sim owner = baseline,
        # applies to every sim). Skip events owned by a *different* sim.
        owner = meta.get("sim_id")
        if owner and owner != sid:
            continue
        status = props.get("status")
        if status == "pending":
            stakes = props.get("stakes")
            due = props.get("due_tick")
            due_txt = ""
            if isinstance(due, int):
                remaining = due - cur_tick
                due_txt = "（迫在眉睫）" if remaining <= 1 else f"（还有约 {remaining} 步）" if remaining > 0 else "（已到期）"
            line = f"· 即将发生：{e.name}" + (f"——{stakes}" if stakes else "") + due_txt
            pending.append((due if isinstance(due, int) else 10**9, line))
        elif status == "resolved":
            rt = props.get("resolved_tick")
            if not isinstance(rt, int):
                rt = meta.get("tick", 0)
            if rt < window_floor:
                continue
            outcome = props.get("outcome") or props.get("description") or ""
            line = f"· 已发生：{e.name}" + (f"——结果：{outcome}" if outcome else "")
            resolved.append((rt, line))

    if not pending and not resolved:
        return ""

    out: list[str] = ["【当前态势】"]
    if resolved:
        resolved.sort(key=lambda x: -x[0])
        out.extend(l for _, l in resolved[:4])
    if pending:
        pending.sort(key=lambda x: x[0])
        out.extend(l for _, l in pending[:4])
    return "\n".join(out)


def _canon_facts_block(sim, *, limit: int = 12) -> str:
    """All resolved outcomes this sim must treat as immutable premises."""
    pid = sim.project_id
    sid = sim.id
    rows: list[tuple] = []
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event":
            continue
        props = e.properties or {}
        if props.get("status") != "resolved":
            continue
        meta = props.get("_sim") if isinstance(props.get("_sim"), dict) else {}
        owner = meta.get("sim_id")
        if owner and owner != sid:
            continue
        outcome = (props.get("outcome") or "").strip()
        if not outcome:
            continue
        rt = props.get("resolved_tick")
        if not isinstance(rt, int):
            rt = meta.get("resolved_tick", 0)
        rows.append((rt if isinstance(rt, int) else 0, e.name, outcome))
    if not rows:
        return ""
    rows.sort(key=lambda x: x[0])
    lines = [f"· {name}：{outcome}" for _, name, outcome in rows[-limit:]]
    return "【既定事实（不可推翻）】\n" + "\n".join(lines)


def _goal_block(sim, observer_id: str, partner_id: str) -> str:
    """Explicit goal injection for the acting agent."""
    observer = graph_engine.entities.get(observer_id)
    partner = graph_engine.entities.get(partner_id)
    if not observer:
        return ""
    obs_goal = (observer.properties or {}).get("goal") or ""
    lines = [f"【我的目标】{obs_goal or '（未明确）'}"]
    if partner:
        p_goal = (partner.properties or {}).get("goal") or ""
        if p_goal:
            lines.append(f"【眼前之人·{partner.name}的目标】{p_goal}")
    return "\n".join(lines)


async def build_actor_context(
    db: AsyncSession, sim, observer_id: str, partner_id: str,
    *, world_entries: list | None = None, worldbook_budget: int = 1200,
    recent_k: int = 6,
) -> dict:
    pid = sim.project_id
    sid = sim.id
    lines: list[str] = []

    if world_entries:
        in_scene = {
            eid for eid in (observer_id, partner_id)
            if (e := graph_engine.entities.get(eid))
            and visibility.entity_visible_to(e, observer_id, graph_engine)
        }
        wb = worldbook.build_injection(
            world_entries, in_scene, observer_id=observer_id, token_budget=worldbook_budget,
        )
        if wb:
            lines.append(wb)
            lines.append("")

    canon = _canon_facts_block(sim)
    if canon:
        lines.append(canon)
        lines.append("")

    goals = _goal_block(sim, observer_id, partner_id)
    if goals:
        lines.append(goals)
        lines.append("")

    situation = _situation_block(sim, observer_id, partner_id, recent_k)
    if situation:
        lines.append(situation)
        lines.append("")

    believed_rel_lines: list[str] = []
    rel_seen: set = set()

    # In-scene pair relation: always canonical.
    pair_rel = _relation_between(observer_id, observer_id, partner_id)
    if pair_rel:
        fmt = _format_relation_row(pair_rel, observer_id)
        believed_rel_lines.append(fmt["label"])
        rel_seen.add((pair_rel["source_id"], pair_rel["target_id"], pair_rel["type"]))

    for sid_entity in (observer_id, partner_id):
        subject = graph_engine.entities.get(sid_entity)
        if not subject:
            continue
        b = await _get_belief(db, pid, observer_id, sid_entity, simulation_id=sid)
        if b is not None:
            props = _merge_in_scene_props(observer_id, sid_entity, partner_id, b.believed_properties or {})
            rels = b.believed_relations or []
        else:
            props = _visible_props(observer_id, subject)
            rels = _visible_relations(observer_id, sid_entity)
        type_label = engine_mod.ENTITY_TYPE_LABELS.get(subject.type, subject.type)
        tag = "（你）" if sid_entity == observer_id else ""
        lines.extend(_render_belief_block(subject.name + tag, type_label, props))
        lines.append("")
        for r in rels:
            key = (r.get("source_id"), r.get("target_id"), r.get("type"))
            if key in rel_seen:
                continue
            pair_ids = {observer_id, partner_id}
            if r.get("source_id") not in pair_ids and r.get("target_id") not in pair_ids:
                continue
            rel_seen.add(key)
            fmt = _format_relation_row(r, observer_id)
            believed_rel_lines.append(fmt["label"])

    if believed_rel_lines:
        lines.append("【你所知的关系网】")
        lines.extend(believed_rel_lines)

    return {"system_injection": "\n".join(lines).strip()}


async def build_scene_belief_context(
    db: AsyncSession,
    project_id: str,
    observer_id: str,
    scene_entity_ids: list[str],
    *,
    simulation_id: str | None = None,
    context_hop: int = 2,
    world_entries: list | None = None,
    worldbook_budget: int = 1200,
) -> dict:
    pid = project_id
    hop = max(1, min(5, int(context_hop)))
    selected = [eid for eid in scene_entity_ids if eid in graph_engine.entities]
    selected_set = set(selected)
    lines: list[str] = []
    warnings: list[str] = []

    in_scene = {
        eid for eid in selected
        if (e := graph_engine.entities.get(eid))
        and visibility.entity_visible_to(e, observer_id, graph_engine)
    }

    if world_entries:
        wb = worldbook.build_injection(
            world_entries, in_scene, observer_id=observer_id, token_budget=worldbook_budget,
        )
        if wb:
            lines.append(wb)
            lines.append("")

    believed_rel_lines: list[str] = []
    rel_seen: set = set()

    for subj_id in selected:
        subject = graph_engine.entities.get(subj_id)
        if not subject:
            continue
        if not visibility.entity_visible_to(subject, observer_id, graph_engine):
            continue
        b = await _get_belief(
            db, pid, observer_id, subj_id, simulation_id=simulation_id,
        )
        if b is not None:
            props = b.believed_properties or {}
            rels = b.believed_relations or []
        else:
            props = _visible_props(observer_id, subject)
            rels = _visible_relations(observer_id, subj_id)
        type_label = engine_mod.ENTITY_TYPE_LABELS.get(subject.type, subject.type)
        tag = "（你）" if subj_id == observer_id else ""
        lines.extend(_render_belief_block(subject.name + tag, type_label, props))
        lines.append("")
        for r in rels:
            key = (r.get("source_id"), r.get("target_id"), r.get("type"))
            if key in rel_seen:
                continue
            rel_seen.add(key)
            if r.get("source_id") not in selected_set and r.get("target_id") not in selected_set:
                continue
            fmt = _format_relation_row(r, observer_id)
            believed_rel_lines.append(fmt["label"])
            w = r.get("weight") or 0.5
            if r.get("type") in ("enemy", "rival") and w > 0.7:
                warnings.append(
                    f"{fmt['source_name']}与{fmt['target_name']}当前关系："
                    f"{fmt['type_label']}（强度{w:.0%}）"
                )

    if believed_rel_lines:
        lines.append("【你所知的关系网】")
        lines.extend(believed_rel_lines)
        lines.append("")

    neighbor_ids: set[str] = set()
    for eid in selected:
        if eid not in graph_engine.entities:
            continue
        result = graph_engine.get_neighbors(eid, hop=hop, project_id=pid)
        for nid in result.get("hop_map", {}):
            if nid in selected_set:
                continue
            ent = graph_engine.entities.get(nid)
            if not ent or not visibility.entity_visible_to(ent, observer_id, graph_engine):
                continue
            neighbor_ids.add(nid)

    neighbor_lines = []
    for nid in sorted(neighbor_ids):
        ent = graph_engine.entities.get(nid)
        if not ent:
            continue
        b = await _get_belief(db, pid, observer_id, nid, simulation_id=simulation_id)
        if b is not None:
            props = b.believed_properties or {}
            blurb = props.get("description") or props.get("personality") or ""
            if blurb and len(blurb) > 40:
                blurb = blurb[:40] + "…"
            type_label = engine_mod.ENTITY_TYPE_LABELS.get(ent.type, ent.type)
            neighbor_lines.append(
                f"{ent.name}（{type_label}）" + (f"：{blurb}" if blurb else "")
            )
        else:
            neighbor_lines.append(graph_engine._entity_oneliner(ent, observer_id=observer_id))

    if neighbor_lines:
        lines.append("【你所知的关联】")
        lines.extend(neighbor_lines)

    system_injection = "\n".join(lines).strip()
    return {
        "system_injection": system_injection,
        "active_warnings": warnings,
        "token_count": len(system_injection) // 2,
    }


async def reconcile_belief(
    db: AsyncSession, sim, observer_id: str, subject_id: str,
    revealed_props: dict, *, config: dict | None = None,
) -> dict | None:
    if not revealed_props:
        return None
    pid = sim.project_id
    sid = sim.id
    observer = graph_engine.entities.get(observer_id)
    subject = graph_engine.entities.get(subject_id)
    if not observer or not subject:
        return None

    b = await _get_belief(db, pid, observer_id, subject_id, simulation_id=sid)
    believed = dict((b.believed_properties if b else {}) or {})

    self_b = await _get_belief(db, pid, observer_id, observer_id, simulation_id=sid)
    self_goal = (self_b.believed_properties or {}).get("goal") if self_b else None

    result = await ai_service.ai_reconcile_belief(
        observer.name, subject.name, believed, revealed_props,
        self_goal=self_goal, config=config,
    )
    updates = result.get("belief_updates") or dict(revealed_props)
    believed.update(updates)
    await _upsert_belief(
        db, pid, observer_id, subject_id, believed,
        (b.believed_relations if b else []) or [],
        tick=sim.current_tick or 0, simulation_id=sid,
    )

    new_goal = result.get("goal")
    if new_goal:
        self_props = dict((self_b.believed_properties if self_b else {}) or {})
        self_props["goal"] = new_goal
        await _upsert_belief(
            db, pid, observer_id, observer_id, self_props,
            (self_b.believed_relations if self_b else []) or [],
            tick=sim.current_tick or 0, simulation_id=sid,
        )
    await db.flush()
    return {"observer": observer.name, "subject": subject.name,
            "revealed": list(updates.keys()), "new_goal": new_goal}


def _truth_relations_for_subject(observer_id: str, subject_id: str) -> list[dict]:
    rows = _visible_relations(observer_id, subject_id)
    return [_format_relation_row(r, observer_id) for r in rows]


async def snapshot_beliefs(db: AsyncSession, sim) -> list[dict]:
    rows = (await db.execute(
        select(Belief).where(Belief.simulation_id == sim.id)
    )).scalars().all()
    return [
        {
            "observer_id": b.observer_id, "subject_id": b.subject_id,
            "believed_properties": b.believed_properties or {},
            "believed_relations": b.believed_relations or [],
            "as_of_tick": b.as_of_tick,
        }
        for b in rows
    ]


async def get_belief_map(
    db: AsyncSession, project_id: str, observer_id: str,
    *, simulation_id: str,
) -> list[dict]:
    rows = (await db.execute(
        select(Belief).where(
            Belief.simulation_id == simulation_id,
            Belief.observer_id == observer_id,
        )
    )).scalars().all()
    out = []
    for b in rows:
        subject = graph_engine.entities.get(b.subject_id)
        if not subject:
            continue
        truth = {
            k: v for k, v in (subject.properties or {}).items()
            if k not in engine_mod._SKIP_PROP_KEYS and v not in (None, "", [], {})
        }
        believed_rels = [
            _format_relation_row(r, observer_id) for r in (b.believed_relations or [])
        ]
        truth_rels = _truth_relations_for_subject(observer_id, b.subject_id)
        out.append({
            "subject_id": b.subject_id,
            "subject_name": subject.name,
            "subject_type": subject.type,
            "believed_properties": b.believed_properties or {},
            "truth_properties": truth,
            "believed_relations": believed_rels,
            "truth_relations": truth_rels,
            "as_of_tick": b.as_of_tick,
        })
    return out
