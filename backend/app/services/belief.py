"""Per-agent cognition (P4) — each agent keeps its own copy of the world.

Four-layer state (plan): canonical truth (Entity/Relation) · belief (Belief rows,
one per observer×subject) · memory (AgentMemory) · visibility (entity meta-fields).

This module owns the belief layer:

- **seed_beliefs** — at sim start, give every character a belief about each entity
  it can currently *see* (visibility-filtered truth). Hidden entities/props are
  simply absent → fog of war.
- **build_actor_context** — the Actor acts from its OWN belief copy, which may be
  stale or wrong, NOT from canonical truth.
- **sync_beliefs** — mechanical step: after a tick, what each participant actually
  perceived (currently-visible truth of who it met) is copied into its beliefs
  with an as_of_tick stamp. Unperceived subjects stay stale.
- **reconcile_belief** — when visibility opens and a hidden truth is revealed to
  specific observers, the Oracle folds it into their belief and may re-derive
  their goal (LLM; falls back to a mechanical fold).

Beliefs are project-scoped (not sim-scoped) and persist on the Belief table.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Belief, Entity
from app.graph import visibility
from app.graph import engine as engine_mod
from app.graph.engine import graph_engine
from app.graph import worldbook
from app.services import ai_service


# ── visible-truth extraction (what an observer can currently perceive) ──

def _visible_props(observer_id: str, subject: Entity) -> dict:
    """Subject's properties as `observer_id` is allowed to read them, minus the
    internal/meta keys the context renderer skips."""
    props = visibility.filter_properties(subject, observer_id, graph_engine)
    return {
        k: v for k, v in (props or {}).items()
        if k not in engine_mod._SKIP_PROP_KEYS and v not in (None, "", [], {})
    }


def _visible_relations(observer_id: str, subject_id: str) -> list[dict]:
    """Relations touching subject that are visible to observer, as plain dicts."""
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


# ── upsert / query ──────────────────────────────────────────────

async def _get_belief(db: AsyncSession, project_id: str, observer_id: str, subject_id: str) -> Belief | None:
    return (await db.execute(
        select(Belief).where(
            Belief.project_id == project_id,
            Belief.observer_id == observer_id,
            Belief.subject_id == subject_id,
        )
    )).scalar_one_or_none()


async def _upsert_belief(
    db: AsyncSession, project_id: str, observer_id: str, subject_id: str,
    props: dict, relations: list[dict], tick: int,
) -> Belief:
    import uuid
    row = await _get_belief(db, project_id, observer_id, subject_id)
    if row is None:
        row = Belief(
            id=str(uuid.uuid4()), project_id=project_id,
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


# ── seeding ──────────────────────────────────────────────────────

async def seed_beliefs_for_project(db: AsyncSession, project_id: str, *, tick: int = 0) -> int:
    """Idempotent belief seed for a project (no Simulation required)."""
    pid = project_id
    existing = (await db.execute(
        select(Belief.id).where(Belief.project_id == pid).limit(1)
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
                tick=tick,
            )
            created += 1
    await db.flush()
    return created


async def seed_beliefs(db: AsyncSession, sim) -> int:
    """Give each character a starting belief about every entity it can currently
    see (visibility-filtered truth). Idempotent: skips if the project already has
    any belief rows. Returns the number of belief rows created."""
    return await seed_beliefs_for_project(db, sim.project_id, tick=0)


# ── mechanical sync (step 6) ─────────────────────────────────────

async def sync_beliefs(db: AsyncSession, sim, tick: int, perceptions: list[tuple[str, str]]) -> None:
    """Copy currently-visible truth of each perceived subject into the
    perceiver's belief (as_of_tick=tick). `perceptions` = (observer_id, subject_id)
    pairs — typically each encounter participant perceiving the other and itself."""
    pid = sim.project_id
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
            tick=tick,
        )
    await db.flush()


# ── belief-backed Actor context (step 2) ─────────────────────────

def _render_belief_block(name: str, type_label: str, props: dict) -> list[str]:
    lines = [f"【{name}（{type_label}）】"]
    lines.extend(engine_mod._format_props(props))
    return lines


async def build_actor_context(
    db: AsyncSession, sim, observer_id: str, partner_id: str,
    *, world_entries: list | None = None, worldbook_budget: int = 1200,
) -> dict:
    """Build the Actor's scene context from the OBSERVER'S beliefs (stale/partial),
    not canonical truth. Falls back to currently-visible truth for a subject the
    observer has no belief about yet (first contact). Returns {system_injection}.
    """
    pid = sim.project_id
    lines: list[str] = []

    # World Book (graph-anchored), filtered by what the observer may see.
    if world_entries:
        in_scene = {
            eid for eid in (observer_id, partner_id)
            if (e := graph_engine.entities.get(eid)) and visibility.entity_visible_to(e, observer_id, graph_engine)
        }
        wb = worldbook.build_injection(
            world_entries, in_scene, observer_id=observer_id, token_budget=worldbook_budget,
        )
        if wb:
            lines.append(wb)
            lines.append("")

    # Belief blocks for the observer (self) and the partner, drawn from beliefs.
    believed_rel_lines: list[str] = []
    rel_seen: set = set()
    for sid in (observer_id, partner_id):
        subject = graph_engine.entities.get(sid)
        if not subject:
            continue
        b = await _get_belief(db, pid, observer_id, sid)
        if b is not None:
            props = b.believed_properties or {}
            rels = b.believed_relations or []
        else:
            # First contact: perceive currently-visible truth.
            props = _visible_props(observer_id, subject)
            rels = _visible_relations(observer_id, sid)
        type_label = engine_mod.ENTITY_TYPE_LABELS.get(subject.type, subject.type)
        tag = "（你）" if sid == observer_id else ""
        block = _render_belief_block(subject.name + tag, type_label, props)
        lines.extend(block)
        lines.append("")
        # Collect believed relations touching the two participants.
        for r in rels:
            key = (r.get("source_id"), r.get("target_id"), r.get("type"))
            if key in rel_seen:
                continue
            rel_seen.add(key)
            src = graph_engine.entities.get(r.get("source_id"))
            tgt = graph_engine.entities.get(r.get("target_id"))
            if not src or not tgt:
                continue
            rlabel = engine_mod.RELATION_TYPE_LABELS.get(r.get("type"), r.get("type"))
            line = f"{src.name} --[{rlabel}]--> {tgt.name}"
            if r.get("description"):
                line += f"（{r['description']}）"
            believed_rel_lines.append(line)

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
    context_hop: int = 2,
    world_entries: list | None = None,
    worldbook_budget: int = 1200,
) -> dict:
    """ST-facing belief context for N in-scene entities + belief-known neighbors."""
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

    for sid in selected:
        subject = graph_engine.entities.get(sid)
        if not subject:
            continue
        if not visibility.entity_visible_to(subject, observer_id, graph_engine):
            continue
        b = await _get_belief(db, pid, observer_id, sid)
        if b is not None:
            props = b.believed_properties or {}
            rels = b.believed_relations or []
        else:
            props = _visible_props(observer_id, subject)
            rels = _visible_relations(observer_id, sid)
        type_label = engine_mod.ENTITY_TYPE_LABELS.get(subject.type, subject.type)
        tag = "（你）" if sid == observer_id else ""
        lines.extend(_render_belief_block(subject.name + tag, type_label, props))
        lines.append("")
        for r in rels:
            key = (r.get("source_id"), r.get("target_id"), r.get("type"))
            if key in rel_seen:
                continue
            rel_seen.add(key)
            src = graph_engine.entities.get(r.get("source_id"))
            tgt = graph_engine.entities.get(r.get("target_id"))
            if not src or not tgt:
                continue
            if r.get("source_id") not in selected_set and r.get("target_id") not in selected_set:
                continue
            rlabel = engine_mod.RELATION_TYPE_LABELS.get(r.get("type"), r.get("type"))
            line = f"{src.name} --[{rlabel}]--> {tgt.name}"
            if r.get("description"):
                line += f"（{r['description']}）"
            believed_rel_lines.append(line)
            w = r.get("weight") or 0.5
            if r.get("type") in ("enemy", "rival") and w > 0.7:
                warnings.append(f"{src.name}与{tgt.name}当前关系：{rlabel}（强度{w:.0%}）")

    if believed_rel_lines:
        lines.append("【你所知的关系网】")
        lines.extend(believed_rel_lines)
        lines.append("")

    # N-hop neighbors: belief blurb if known, else visibility-filtered one-liner.
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
        b = await _get_belief(db, pid, observer_id, nid)
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


# ── belief reconciliation on reveal (step 3c) ────────────────────

async def reconcile_belief(
    db: AsyncSession, sim, observer_id: str, subject_id: str,
    revealed_props: dict, *, config: dict | None = None,
) -> dict | None:
    """A hidden truth about `subject_id` just became visible to `observer_id`.
    Fold it into the observer's belief and (via Oracle) maybe re-derive the
    observer's own goal. Returns a small log dict, or None if nothing changed."""
    if not revealed_props:
        return None
    pid = sim.project_id
    observer = graph_engine.entities.get(observer_id)
    subject = graph_engine.entities.get(subject_id)
    if not observer or not subject:
        return None

    b = await _get_belief(db, pid, observer_id, subject_id)
    believed = dict((b.believed_properties if b else {}) or {})

    self_b = await _get_belief(db, pid, observer_id, observer_id)
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
        tick=sim.current_tick or 0,
    )

    new_goal = result.get("goal")
    if new_goal:
        self_props = dict((self_b.believed_properties if self_b else {}) or {})
        self_props["goal"] = new_goal
        await _upsert_belief(
            db, pid, observer_id, observer_id, self_props,
            (self_b.believed_relations if self_b else []) or [],
            tick=sim.current_tick or 0,
        )
    await db.flush()
    return {"observer": observer.name, "subject": subject.name,
            "revealed": list(updates.keys()), "new_goal": new_goal}


# ── snapshot / query helpers ─────────────────────────────────────

async def snapshot_beliefs(db: AsyncSession, project_id: str) -> list[dict]:
    """All belief rows of a project, for the SimTick snapshot (replay)."""
    rows = (await db.execute(
        select(Belief).where(Belief.project_id == project_id)
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


async def get_belief_map(db: AsyncSession, project_id: str, observer_id: str) -> list[dict]:
    """One observer's beliefs paired with current canonical truth, for the
    belief-vs-truth comparison view. Diffs are computed on the frontend."""
    rows = (await db.execute(
        select(Belief).where(
            Belief.project_id == project_id, Belief.observer_id == observer_id
        )
    )).scalars().all()
    out = []
    for b in rows:
        subject = graph_engine.entities.get(b.subject_id)
        if not subject:
            continue
        # Canonical truth (omniscient) for the same keys.
        truth = {
            k: v for k, v in (subject.properties or {}).items()
            if k not in engine_mod._SKIP_PROP_KEYS and v not in (None, "", [], {})
        }
        out.append({
            "subject_id": b.subject_id,
            "subject_name": subject.name,
            "subject_type": subject.type,
            "believed_properties": b.believed_properties or {},
            "truth_properties": truth,
            "as_of_tick": b.as_of_tick,
        })
    return out
