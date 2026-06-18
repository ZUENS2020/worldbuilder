"""Simulation tick engine — the core loop.

P1 scope (full-knowledge): scheduler → Actor → Oracle adjudicate → apply the
four mutation classes (relation weight / relation type-or-new / internal state /
new entity) → append episodic memory → maybe compact → write a full SimTick
snapshot. Belief filtering (P4), visibility (P2), worldbook (P3), background loop
+ nudges (P5) layer on later via the hooks left here.

Mutations are dual-written: SQLite (source of truth) + graph_engine (in-memory
mirror), mirroring the pattern in routers/entities.py and routers/transforms.py.
"""

import random
import time
import uuid

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Entity, Relation, Simulation, SimTick, WorldEntry, Belief, AgentMemory,
)
from app.graph.engine import graph_engine
from app.services import ai_service
from app.services import belief
from app.services import drama
from app.services.memory import append_memory, get_memory_block, maybe_compact


# ── config defaults ──────────────────────────────────────────────
DEFAULT_CONFIG = {
    "max_encounters_per_tick": 4,
    "allow_new_entities": False,
    "temperature": 0.8,
    "scheduler_strategy": "weighted",   # weighted | random
    "memory_recent_k": 8,
    "memory_compact_threshold": 12,
    "generate_events": True,          # Oracle crystallizes significant happenings into event nodes
    "event_min_significance": 0.5,    # only events at/above this significance become nodes
    # P5 background loop / stop conditions
    "tick_interval_sec": 6,           # seconds between ticks when running in the background
    "max_ticks": 0,                   # 0 = unlimited; otherwise auto-pause at this tick
    "stability_window": 0,            # 0 = off; auto-pause after N consecutive zero-mutation ticks
    # P5 heuristic perturbation (nudge / muse) — decision 12
    "nudge_strategy": "off",          # off | random | targeted | weighted
    "nudge_every_n_ticks": 1,         # emit nudges every N ticks
    "nudge_targets_per_tick": 1,      # how many agents receive an impulse per nudge tick
    "nudge_intensity": 0.5,           # 0~1 — how strong/insistent the impulse feels
    "nudge_target_ids": [],           # explicit targets when strategy == targeted
    "writeback_trigger": "manual",       # manual | every_n_rounds | auto_llm
    "writeback_every_n": 3,
    "writeback_depth": "mechanical",     # mechanical | llm_oracle
    "st_source_label": "",
}

# Drama-enhancement controls (戏剧化) — switchable mechanisms + master intensity
# dial. Defined in drama.py and merged here so they share one config surface.
DEFAULT_CONFIG.update(drama.DEFAULTS)


def _cfg(sim: Simulation, key: str):
    return (sim.config or {}).get(key, DEFAULT_CONFIG.get(key))


# ── scheduler ────────────────────────────────────────────────────

def _pick_encounters(sim: Simulation) -> list[tuple[str, str]]:
    """Choose which character pairs interact this tick.

    hybrid: prefer existing relations (higher weight = more likely to meet),
    sprinkle randomness. full_llm: every character pairs with a neighbour.
    Returns a list of (entity_id_a, entity_id_b)."""
    pid = sim.project_id
    char_ids = [
        eid for eid in graph_engine.project_entities.get(pid, set())
        if eid in graph_engine.entities and graph_engine.entities[eid].type == "character"
    ]
    if len(char_ids) < 2:
        return []

    max_n = int(_cfg(sim, "max_encounters_per_tick") or 4)
    strategy = _cfg(sim, "scheduler_strategy")

    # Candidate pairs from existing relations between two characters.
    char_set = set(char_ids)
    rel_pairs: dict[frozenset, float] = {}
    for r in graph_engine.get_project_relations(pid):
        if r.source_id in char_set and r.target_id in char_set:
            key = frozenset((r.source_id, r.target_id))
            rel_pairs[key] = max(rel_pairs.get(key, 0.0), r.weight or 0.5)

    pairs: list[tuple[str, str]] = []
    if sim.driver_mode == "full_llm":
        # Every character meets one (preferring a related) partner.
        for cid in char_ids:
            partners = [tuple(k - {cid})[0] for k in rel_pairs if cid in k]
            partner = random.choice(partners) if partners else random.choice(
                [c for c in char_ids if c != cid]
            )
            pairs.append((cid, partner))
    else:
        candidates = list(rel_pairs.items())
        if strategy == "random" or not candidates:
            random.shuffle(char_ids)
            for i in range(0, min(len(char_ids) - 1, max_n * 2), 2):
                pairs.append((char_ids[i], char_ids[i + 1]))
        else:  # weighted by relation strength
            keys = [k for k, _ in candidates]
            weights = [w for _, w in candidates]
            chosen = _weighted_sample(keys, weights, max_n)
            pairs = [tuple(k) for k in chosen]

    # Drama scheduler: deliberately seed some charged encounters (enemies /
    # strangers) ahead of the organic pairs so conflict actually gets staged.
    if drama.on(sim, "drama_scheduler"):
        lvl = drama.level(sim)
        n_charged = max(1, round(lvl * max_n)) if lvl > 0 else 1
        charged = drama.charged_pairs(pid, char_ids, rel_pairs, n_charged)
        pairs = charged + pairs  # charged take priority before the cap

    # Dedup and cap.
    seen = set()
    out = []
    for a, b in pairs:
        key = frozenset((a, b))
        if a == b or key in seen:
            continue
        seen.add(key)
        out.append((a, b))
        if len(out) >= max_n:
            break
    return out


def _weighted_sample(items, weights, k):
    """Sample up to k distinct items with probability ∝ weight (no numpy)."""
    items = list(items)
    weights = list(weights)
    out = []
    for _ in range(min(k, len(items))):
        total = sum(weights)
        if total <= 0:
            break
        r = random.uniform(0, total)
        acc = 0.0
        for i, w in enumerate(weights):
            acc += w
            if r <= acc:
                out.append(items.pop(i))
                weights.pop(i)
                break
    return out


# ── heuristic perturbation (nudge / muse) — decision 12 ──────────

def _nudge_world_blurb(pid: str, target_id: str) -> str:
    """A tiny omniscient blurb about the target's situation, fed to the Oracle
    so its impulse feels grounded. The Oracle is told NOT to leak it verbatim."""
    e = graph_engine.entities.get(target_id)
    if not e:
        return ""
    bits = []
    goal = (e.properties or {}).get("goal")
    mood = (e.properties or {}).get("mood")
    if goal:
        bits.append(f"目标：{goal}")
    if mood:
        bits.append(f"情绪：{mood}")
    rels = []
    for r in graph_engine.adjacency.get(target_id, [])[:5]:
        other_id = r.target_id if r.source_id == target_id else r.source_id
        other = graph_engine.entities.get(other_id)
        if other and other.type == "character":
            rels.append(f"{other.name}({r.type} {r.weight:.1f})")
    if rels:
        bits.append("关系：" + "、".join(rels))
    return "；".join(bits)


def _pick_nudge_targets(sim: Simulation, tick: int) -> list[str]:
    """Choose which agents get an impulse this tick, per nudge_strategy."""
    strategy = _cfg(sim, "nudge_strategy")
    if not strategy or strategy == "off":
        return []
    every_n = max(1, int(_cfg(sim, "nudge_every_n_ticks") or 1))
    if tick % every_n != 0:
        return []
    n = max(1, int(_cfg(sim, "nudge_targets_per_tick") or 1))
    pid = sim.project_id

    if strategy == "targeted":
        ids = [tid for tid in (_cfg(sim, "nudge_target_ids") or []) if tid in graph_engine.entities]
        return ids[:n]

    char_ids = [
        eid for eid in graph_engine.project_entities.get(pid, set())
        if (e := graph_engine.entities.get(eid)) and e.type == "character"
    ]
    if not char_ids:
        return []

    if strategy == "weighted":
        # Favor well-connected agents (more relations = more likely to be nudged).
        weights = [max(1, len(graph_engine.adjacency.get(cid, []))) for cid in char_ids]
        return [str(x) for x in _weighted_sample(char_ids, weights, n)]
    # random
    random.shuffle(char_ids)
    return char_ids[:n]


async def _emit_nudges(db: AsyncSession, sim: Simulation, tick: int, config: dict) -> dict[str, str]:
    """Step 0: deliver fuzzy intuition impulses to selected agents. Each impulse
    lands as a low-salience 预感 memory AND is returned (keyed by entity NAME) so
    the Actor pass can inject it into those agents' scene context this tick."""
    targets = _pick_nudge_targets(sim, tick)
    if not targets:
        return {}
    intensity = float(_cfg(sim, "nudge_intensity") or 0.5)
    out: dict[str, str] = {}
    for tid in targets:
        e = graph_engine.entities.get(tid)
        if not e:
            continue
        impulse = await ai_service.ai_generate_nudge(
            e.name, _nudge_world_blurb(sim.project_id, tid),
            intensity=intensity, config=config,
        )
        if not impulse:
            continue
        out[e.name] = impulse
        await append_memory(
            db, project_id=sim.project_id, simulation_id=sim.id, entity_id=tid,
            tick=tick, content=f"（一阵{('强烈' if intensity >= 0.75 else '模糊')}的预感）{impulse}",
            participants=[], salience=0.15,
        )
    await db.flush()
    return out


# ── mutation application (dual-write) ────────────────────────────

def _name_index(pid: str) -> dict[str, Entity]:
    idx = {}
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if e:
            idx[e.name] = e
    return idx


def _find_relation(pid: str, a_id: str, b_id: str) -> Relation | None:
    for r in graph_engine.adjacency.get(a_id, []):
        if r.project_id != pid:
            continue
        if {r.source_id, r.target_id} == {a_id, b_id}:
            return r
    return None


async def _apply_mutations(
    db: AsyncSession, sim: Simulation, mutations: list[dict], new_entities: list[dict]
) -> list[dict]:
    """Apply Oracle output to DB + graph_engine. Returns the applied log."""
    pid = sim.project_id
    applied: list[dict] = []
    name_idx = _name_index(pid)

    # New entities first so later mutations can reference them by name.
    for ne in new_entities:
        name = (ne.get("name") or "").strip()
        if not name or name in name_idx:
            continue
        etype = ne.get("type") or "character"
        entity = Entity(
            id=str(uuid.uuid4()),
            name=name,
            type=etype,
            properties=ne.get("properties") or {},
            project_id=pid,
        )
        db.add(entity)
        await db.flush()
        graph_engine.add_entity(entity)
        name_idx[name] = entity
        applied.append({"op": "create_entity", "name": name, "type": etype, "id": entity.id})

    for m in mutations:
        op = m.get("op")
        try:
            if op == "update_entity":
                ent_g = name_idx.get(m.get("entity"))
                if not ent_g:
                    continue
                # Write to the session-bound row; graph holds detached objects.
                ent = await db.get(Entity, ent_g.id)
                if not ent:
                    continue
                props = dict(ent.properties or {})
                props.update(m.get("properties") or {})
                ent.properties = props
                ent_g.properties = props  # mirror into in-memory graph
                applied.append({"op": op, "entity": ent.name, "properties": m.get("properties")})

            elif op in ("update_relation", "create_relation"):
                src = name_idx.get(m.get("source"))
                tgt = name_idx.get(m.get("target"))
                if not src or not tgt:
                    continue
                rel_g = _find_relation(pid, src.id, tgt.id)
                if rel_g is None:
                    rtype = m.get("type") or "ally"
                    weight = m.get("weight")
                    if weight is None:
                        weight = max(0.0, min(1.0, 0.5 + (m.get("weight_delta") or 0.0)))
                    rel = Relation(
                        id=str(uuid.uuid4()),
                        source_id=src.id,
                        target_id=tgt.id,
                        type=rtype,
                        properties={"description": m.get("description", "")} if m.get("description") else {},
                        weight=float(weight),
                        project_id=pid,
                    )
                    db.add(rel)
                    await db.flush()
                    graph_engine.add_relation(rel)
                    applied.append({"op": "create_relation", "source": src.name, "target": tgt.name,
                                    "type": rtype, "weight": rel.weight})
                else:
                    rel = await db.get(Relation, rel_g.id)
                    if not rel:
                        continue
                    changed = {}
                    if m.get("weight_delta") is not None:
                        rel.weight = max(0.0, min(1.0, (rel.weight or 0.5) + float(m["weight_delta"])))
                        changed["weight"] = rel.weight
                    if m.get("weight") is not None:
                        rel.weight = max(0.0, min(1.0, float(m["weight"])))
                        changed["weight"] = rel.weight
                    if m.get("type"):
                        rel.type = m["type"]
                        changed["type"] = rel.type
                    if m.get("description"):
                        props = dict(rel.properties or {})
                        props["description"] = m["description"]
                        rel.properties = props
                        rel_g.properties = props
                    # mirror scalar changes into the in-memory graph object
                    if "weight" in changed:
                        rel_g.weight = rel.weight
                    if "type" in changed:
                        rel_g.type = rel.type
                    applied.append({"op": "update_relation", "source": src.name,
                                    "target": tgt.name, **changed})

            elif op == "set_prop_visibility":
                # Oracle visibility landing: materialize a per-property whitelist
                # onto the subject entity's _prop_visibility meta-field.
                ent_g = name_idx.get(m.get("entity"))
                key = m.get("key")
                if not ent_g or not key:
                    continue
                ent = await db.get(Entity, ent_g.id)
                if not ent:
                    continue
                level = m.get("level") or "public"
                rule = {"level": level}
                if level == "entities":
                    # Resolve allowed entity names → ids (the materialized whitelist).
                    allowed_ids = [
                        name_idx[n].id for n in (m.get("entities") or []) if n in name_idx
                    ]
                    rule["entities"] = allowed_ids
                props = dict(ent.properties or {})
                prop_vis = dict(props.get("_prop_visibility") or {})
                prop_vis[key] = rule
                props["_prop_visibility"] = prop_vis
                ent.properties = props
                ent_g.properties = props
                applied.append({"op": op, "entity": ent.name, "key": key, "level": level,
                                "entities": rule.get("entities", [])})

            elif op == "set_entity_visibility":
                # Oracle visibility landing: entity-level existence visibility.
                ent_g = name_idx.get(m.get("entity"))
                if not ent_g:
                    continue
                ent = await db.get(Entity, ent_g.id)
                if not ent:
                    continue
                mode = m.get("mode") or "public"
                meta = {"mode": mode}
                if mode == "groups":
                    # groups may reference entity (faction) names → resolve to ids.
                    meta["groups"] = [
                        (name_idx[g].id if g in name_idx else g)
                        for g in (m.get("groups") or [])
                    ]
                elif mode == "predicate":
                    meta["predicate"] = m.get("predicate") or {}
                props = dict(ent.properties or {})
                props["_visibility"] = meta
                ent.properties = props
                ent_g.properties = props
                applied.append({"op": op, "entity": ent.name, "mode": mode})
        except Exception as e:  # never let one bad mutation abort the tick
            applied.append({"op": op, "error": str(e)})

    return applied


# ── event crystallization ────────────────────────────────────────

def _latest_sim_event(pid: str, sim_id: str, before_tick: int) -> Entity | None:
    """The most recent event node this sim emitted at a tick < before_tick,
    used to chain a temporal `followed_by` edge between consecutive events."""
    best = None
    best_tick = -1
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event":
            continue
        meta = (e.properties or {}).get("_sim")
        if not isinstance(meta, dict) or meta.get("sim_id") != sim_id:
            continue
        t = meta.get("tick", -1)
        if t < before_tick and t > best_tick:
            best, best_tick = e, t
    return best


async def _apply_events(
    db: AsyncSession, sim: Simulation, events: list[dict], tick: int, min_significance: float
) -> list[dict]:
    """Crystallize the Oracle's significant happenings into `event` entity nodes,
    wiring each to its participants (`participated`) and to the previous sim event
    (`followed_by`). Dual-written to DB + graph_engine like every other mutation."""
    pid = sim.project_id
    applied: list[dict] = []
    name_idx = _name_index(pid)
    prev_event = _latest_sim_event(pid, sim.id, before_tick=tick)

    for ev in events:
        name = (ev.get("name") or "").strip()
        if not name:
            continue
        try:
            sig = float(ev.get("significance", 0.5))
        except (TypeError, ValueError):
            sig = 0.5
        if sig < min_significance:
            continue

        # Ensure a unique entity name.
        final_name = name
        n = 2
        while final_name in name_idx:
            final_name = f"{name}（{n}）"
            n += 1

        event = Entity(
            id=str(uuid.uuid4()),
            name=final_name,
            type="event",
            properties={
                "description": ev.get("summary", ""),
                "time": f"t{tick}",
                "_sim": {"sim_id": sim.id, "tick": tick, "significance": sig},
            },
            project_id=pid,
        )
        db.add(event)
        await db.flush()
        graph_engine.add_entity(event)
        name_idx[final_name] = event
        applied.append({"op": "create_event", "name": final_name, "tick": tick,
                        "significance": sig, "summary": ev.get("summary", "")})

        # participants → event
        for pname in ev.get("participants", []):
            actor = name_idx.get(pname)
            if not actor or actor.type != "character":
                continue
            rel = Relation(
                id=str(uuid.uuid4()),
                source_id=actor.id, target_id=event.id,
                type="participated", weight=max(0.3, min(1.0, sig)),
                properties={}, project_id=pid,
            )
            db.add(rel)
            await db.flush()
            graph_engine.add_relation(rel)
            applied.append({"op": "create_relation", "source": actor.name,
                            "target": final_name, "type": "participated"})

        # temporal chain: previous sim event → this one
        if prev_event is not None:
            rel = Relation(
                id=str(uuid.uuid4()),
                source_id=prev_event.id, target_id=event.id,
                type="followed_by", weight=0.6, properties={}, project_id=pid,
            )
            db.add(rel)
            await db.flush()
            graph_engine.add_relation(rel)
            applied.append({"op": "create_relation", "source": prev_event.name,
                            "target": final_name, "type": "followed_by"})
        prev_event = event

    return applied


# ── snapshot ─────────────────────────────────────────────────────

async def _build_snapshot(db: AsyncSession, sim: Simulation) -> dict:
    pid = sim.project_id
    relations = []
    for r in graph_engine.get_project_relations(pid):
        relations.append({
            "source_id": r.source_id, "target_id": r.target_id,
            "type": r.type, "weight": r.weight,
        })
    entities = []
    _MUTABLE = ("mood", "goal")
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e:
            continue
        snap = {k: (e.properties or {}).get(k) for k in _MUTABLE if (e.properties or {}).get(k)}
        entities.append({"id": e.id, "name": e.name, "type": e.type, "state": snap})
    beliefs = await belief.snapshot_beliefs(db, pid)
    return {"relations": relations, "entities": entities, "beliefs": beliefs}


# ── tick-0 baseline + reset (replay anchor) ──────────────────────

async def capture_baseline(db: AsyncSession, sim: Simulation) -> SimTick:
    """Write the tick-0 SimTick: a FULL snapshot of canonical state at sim start,
    so `reset_simulation` can faithfully restore the world (decision 3 / reset)."""
    pid = sim.project_id
    entities = {}
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if e:
            entities[e.id] = {"name": e.name, "type": e.type, "properties": dict(e.properties or {})}
    relations = []
    for r in graph_engine.get_project_relations(pid):
        relations.append({
            "id": r.id, "source_id": r.source_id, "target_id": r.target_id,
            "type": r.type, "weight": r.weight, "properties": dict(r.properties or {}),
        })
    # Live snapshot (mutable view) plus the full baseline used only for restore.
    snapshot = await _build_snapshot(db, sim)
    snapshot["baseline"] = {"entities": entities, "relations": relations}

    row = SimTick(
        id=str(uuid.uuid4()), simulation_id=sim.id, project_id=pid, tick=0,
        interactions=[], mutations=[], snapshot=snapshot,
        metrics={"llm_calls": 0, "encounters": 0, "nudges": 0, "mutation_count": 0},
    )
    db.add(row)
    await db.flush()
    return row


def _reset_project_graph(pid: str) -> None:
    """Drop a project's entire in-memory mirror so it can be reloaded from DB."""
    for eid in list(graph_engine.project_entities.get(pid, set())):
        graph_engine.entities.pop(eid, None)
        graph_engine.adjacency.pop(eid, None)
    graph_engine.project_entities[pid] = set()
    graph_engine.project_relations[pid] = set()


async def _reload_project_graph(db: AsyncSession, pid: str) -> None:
    _reset_project_graph(pid)
    ents = (await db.execute(select(Entity).where(Entity.project_id == pid))).scalars().all()
    graph_engine.load_entities(ents)
    rels = (await db.execute(select(Relation).where(Relation.project_id == pid))).scalars().all()
    graph_engine.load_relations(rels)


async def reset_simulation(db: AsyncSession, sim: Simulation) -> dict:
    """Restore canonical state to this sim's tick-0 baseline and wipe its derived
    state (beliefs, memories, ticks>0). Returns a small summary."""
    pid = sim.project_id
    drama.clear_state(sim.id)  # drop transient director / explosion state
    base_row = (await db.execute(
        select(SimTick).where(SimTick.simulation_id == sim.id, SimTick.tick == 0)
    )).scalar_one_or_none()
    baseline = (base_row.snapshot or {}).get("baseline") if base_row else None

    removed_entities = restored_entities = removed_relations = restored_relations = 0

    if baseline:
        base_ents: dict = baseline.get("entities", {})
        base_rels: list = baseline.get("relations", [])
        base_rel_by_id = {r["id"]: r for r in base_rels}

        # Relations: delete sim-created ones, restore baseline ones.
        cur_rels = (await db.execute(select(Relation).where(Relation.project_id == pid))).scalars().all()
        cur_rel_ids = set()
        for r in cur_rels:
            cur_rel_ids.add(r.id)
            if r.id not in base_rel_by_id:
                await db.delete(r)
                removed_relations += 1
            else:
                b = base_rel_by_id[r.id]
                r.type, r.weight, r.properties = b["type"], b["weight"], dict(b.get("properties") or {})
                restored_relations += 1
        # Re-create baseline relations that were deleted during the sim.
        for rid, b in base_rel_by_id.items():
            if rid not in cur_rel_ids:
                db.add(Relation(
                    id=rid, source_id=b["source_id"], target_id=b["target_id"],
                    type=b["type"], weight=b["weight"], properties=dict(b.get("properties") or {}),
                    project_id=pid,
                ))
                restored_relations += 1

        # Entities: delete sim-created ones, restore baseline props.
        cur_ents = (await db.execute(select(Entity).where(Entity.project_id == pid))).scalars().all()
        cur_ent_ids = set()
        for e in cur_ents:
            cur_ent_ids.add(e.id)
            if e.id not in base_ents:
                await db.delete(e)
                removed_entities += 1
            else:
                b = base_ents[e.id]
                e.name, e.type, e.properties = b["name"], b["type"], dict(b.get("properties") or {})
                restored_entities += 1
        for eid, b in base_ents.items():
            if eid not in cur_ent_ids:
                db.add(Entity(id=eid, name=b["name"], type=b["type"],
                              properties=dict(b.get("properties") or {}), project_id=pid))
                restored_entities += 1

    # Wipe derived state: beliefs (project-scoped), this sim's memories, ticks > 0.
    await db.execute(delete(Belief).where(Belief.project_id == pid))
    await db.execute(delete(AgentMemory).where(AgentMemory.simulation_id == sim.id))
    await db.execute(delete(SimTick).where(SimTick.simulation_id == sim.id, SimTick.tick > 0))

    sim.current_tick = 0
    sim.status = "idle"
    await db.commit()

    # Rebuild the in-memory mirror from the restored DB rows.
    if baseline:
        await _reload_project_graph(db, pid)

    return {
        "reset": True, "had_baseline": bool(baseline),
        "removed_entities": removed_entities, "restored_entities": restored_entities,
        "removed_relations": removed_relations, "restored_relations": restored_relations,
    }


# ── public API ───────────────────────────────────────────────────

async def run_tick(db: AsyncSession, sim: Simulation) -> SimTick:
    """Advance the simulation one tick and persist a SimTick row."""
    t0 = time.monotonic()
    tick = (sim.current_tick or 0) + 1
    config = sim.config or {}
    recent_k = int(_cfg(sim, "memory_recent_k") or 8)
    threshold = int(_cfg(sim, "memory_compact_threshold") or 12)
    allow_new = bool(_cfg(sim, "allow_new_entities"))
    gen_events = bool(_cfg(sim, "generate_events"))
    event_min_sig = float(_cfg(sim, "event_min_significance") or 0.5)
    temperature = float(_cfg(sim, "temperature") or 0.8)

    metrics = {"llm_calls": 0, "encounters": 0, "nudges": 0, "mutation_count": 0}

    # Load enabled World Book entries once for this tick (P3 injection).
    we_result = await db.execute(
        select(WorldEntry).where(
            WorldEntry.project_id == sim.project_id, WorldEntry.enabled == 1
        )
    )
    world_entries = we_result.scalars().all()

    # P4: ensure each character has a starting belief copy (idempotent).
    await belief.seed_beliefs(db, sim)

    # 0. heuristic perturbation (nudge / muse) — fuzzy impulses to select agents
    nudges = await _emit_nudges(db, sim, tick, config)
    metrics["nudges"] = len(nudges)

    # 0c. drama layer — global director directive, external shock injection, and
    #     any tension explosions flagged on a previous tick (fire this tick).
    drama_director_note = await drama.maybe_run_director(db, sim, tick, config)
    drama_shock = await drama.maybe_inject_event(db, sim, tick, config)
    drama_explosions = drama.consume_explosions(sim)
    drama_actor_lvl = drama.actor_level(sim)
    drama_oracle_lvl = drama.oracle_level(sim)

    # 1. scheduler
    encounters = _pick_encounters(sim)
    metrics["encounters"] = len(encounters)

    # 2. Actor passes — each encounter is narrated from the INITIATOR's belief
    #    copy (stale/partial), not canonical truth. Info asymmetry is preserved
    #    by sourcing the scene from a single observer; the other party's beliefs
    #    are reconciled mechanically afterward (step 6).
    scenes = []
    for a_id, b_id in encounters:
        a = graph_engine.entities.get(a_id)
        b = graph_engine.entities.get(b_id)
        if not a or not b:
            continue
        ctx = await belief.build_actor_context(
            db, sim, a_id, b_id, world_entries=world_entries,
        )
        mem_blocks = {
            a.name: await get_memory_block(db, simulation_id=sim.id, entity_id=a_id, recent_k=recent_k),
            b.name: await get_memory_block(db, simulation_id=sim.id, entity_id=b_id, recent_k=recent_k),
        }
        scene_nudges = {
            name: nudges[name] for name in (a.name, b.name) if name in nudges
        }
        # Prepend any drama context (shock / director note / impending explosion)
        # so the actors play the scene against it.
        scene_inject = ctx["system_injection"]
        preamble = []
        if drama_shock:
            preamble.append(f"【突发事件】{drama_shock['headline']}：{drama_shock['detail']}")
        if drama_director_note:
            preamble.append(f"【局势】{drama_director_note}")
        if frozenset((a.name, b.name)) in drama_explosions:
            preamble.append("【临界】你们之间积压已久的张力即将到顶，这次相遇很可能爆发激烈的正面冲突或彻底决裂。")
        if preamble:
            scene_inject = "\n".join(preamble) + "\n\n" + scene_inject
        act = await ai_service.ai_act(
            scene_inject, [a.name, b.name], mem_blocks,
            nudges=scene_nudges or None, drama=drama_actor_lvl,
            config=config, temperature=temperature,
        )
        metrics["llm_calls"] += 1
        if act.get("narrative"):
            scenes.append({
                "participants": [a.name, b.name],
                "participant_ids": [a_id, b_id],
                "narrative": act["narrative"],
                "intents": act.get("intents", []),
            })

    # Build the Oracle's authoritative directive from the drama layer (shock,
    # director note, and any explosions that actually surfaced in a scene).
    directive_parts = []
    if drama_shock:
        directive_parts.append(
            f"外部突发事件「{drama_shock['headline']}」：{drama_shock['detail']}"
            f"（卷入：{'、'.join(drama_shock['participants'])}）。让本 tick 的变更反映各方对此事的反应。"
        )
    if drama_director_note:
        directive_parts.append(f"导演调度：{drama_director_note}")
    if drama_explosions:
        scene_pairs = {frozenset(s["participants"]) for s in scenes}
        for p in drama_explosions:
            if p in scene_pairs:
                a_n, b_n = tuple(p)
                directive_parts.append(
                    f"{a_n} 与 {b_n} 之间积压的张力已达临界，必须给出实质性的爆发/决裂/转折（大幅改变其关系）。"
                )
    oracle_directive = "\n".join(directive_parts)

    # 3. Oracle adjudication (whole tick at once = oracle_merge conflict strategy)
    applied_mutations = []
    if scenes:
        catalog = [
            {"name": e.name, "type": e.type}
            for e in (graph_engine.entities.get(eid) for eid in graph_engine.project_entities.get(sim.project_id, set()))
            if e
        ]
        verdict = await ai_service.ai_adjudicate(
            scenes, catalog, allow_new_entities=allow_new,
            generate_events=gen_events, drama=drama_oracle_lvl,
            directive=oracle_directive, config=config,
        )
        metrics["llm_calls"] += 1
        # 4. apply mutations (dual-write)
        applied_mutations = await _apply_mutations(
            db, sim, verdict.get("mutations", []), verdict.get("new_entities", []),
        )
        # 4b. crystallize significant happenings into event nodes (+ participated /
        #     followed_by edges) so the world's history accretes on the graph.
        if gen_events:
            event_ops = await _apply_events(
                db, sim, verdict.get("events", []), tick, event_min_sig,
            )
            applied_mutations.extend(event_ops)
            metrics["events"] = sum(1 for o in event_ops if o.get("op") == "create_event")

    # 4c. crystallize the injected external shock into its own event node, so the
    #     dramatic beat is always visible even if no scene picked it up.
    if drama_shock and drama_shock.get("headline"):
        shock_ev = [{
            "name": drama_shock["headline"],
            "summary": drama_shock["detail"],
            "participants": drama_shock["participants"],
            "significance": max(0.6, drama.level(sim)),
        }]
        shock_ops = await _apply_events(db, sim, shock_ev, tick, 0.0)
        applied_mutations.extend(shock_ops)
        metrics["events"] = metrics.get("events", 0) + sum(
            1 for o in shock_ops if o.get("op") == "create_event"
        )

    # 4d. tension accumulation/release on the scheduled pairs; over-threshold
    #     pairs are flagged to explode on a later tick.
    tension_log = await drama.update_tension(db, sim, scenes, applied_mutations)
    if tension_log:
        applied_mutations.extend(tension_log)

    if drama.any_on(sim):
        metrics["drama"] = {
            "shock": drama_shock["headline"] if drama_shock else None,
            "director": drama_director_note or None,
            "explosions": [list(p) for p in drama_explosions],
            "tension_explode": sum(1 for o in tension_log if o.get("op") == "tension_explode"),
        }
    metrics["mutation_count"] = len(applied_mutations)

    # 3c. Oracle belief re-cognition — when a property was just opened to a
    #     specific whitelist, fold the newly-revealed truth into each of those
    #     observers' beliefs and let them re-derive their goal.
    name_idx = _name_index(sim.project_id)
    for m in applied_mutations:
        if m.get("op") != "set_prop_visibility" or m.get("level") != "entities":
            continue
        subject = name_idx.get(m.get("entity"))
        key = m.get("key")
        if not subject or not key:
            continue
        truth_val = (subject.properties or {}).get(key)
        if truth_val in (None, "", [], {}):
            continue
        for observer_id in (m.get("entities") or []):
            if observer_id == subject.id:
                continue
            await belief.reconcile_belief(
                db, sim, observer_id, subject.id, {key: truth_val}, config=config,
            )
            metrics["llm_calls"] += 1

    # 4e. lodge the external shock as a salient memory for everyone it touched,
    #     so they carry it forward even outside this tick's scenes.
    if drama_shock and drama_shock.get("headline"):
        shock_idx = _name_index(sim.project_id)
        for pname in drama_shock["participants"]:
            pe = shock_idx.get(pname)
            if not pe:
                continue
            await append_memory(
                db, project_id=sim.project_id, simulation_id=sim.id, entity_id=pe.id,
                tick=tick, content=f"（突发事件）{drama_shock['headline']}：{drama_shock['detail']}",
                participants=[n for n in drama_shock["participants"] if n != pname],
                salience=0.8,
            )

    # 5. episodic memory append + 6. compaction
    for s in scenes:
        for name, eid in zip(s["participants"], s["participant_ids"]):
            others = [n for n in s["participants"] if n != name]
            await append_memory(
                db, project_id=sim.project_id, simulation_id=sim.id, entity_id=eid,
                tick=tick, content=s["narrative"], participants=others, salience=0.5,
            )
    await db.flush()
    for s in scenes:
        for eid in s["participant_ids"]:
            await maybe_compact(
                db, simulation_id=sim.id, project_id=sim.project_id, entity_id=eid,
                threshold=threshold, config=config,
            )

    # 6. mechanical belief sync — each participant perceives the other (and
    #    itself); copy currently-visible truth into their belief at this tick.
    perceptions: list[tuple[str, str]] = []
    for s in scenes:
        ids = s["participant_ids"]
        for observer_id in ids:
            for subject_id in ids:
                perceptions.append((observer_id, subject_id))
    if perceptions:
        await belief.sync_beliefs(db, sim, tick, perceptions)

    # 7. snapshot + SimTick row
    snapshot = await _build_snapshot(db, sim)
    metrics["latency_ms"] = int((time.monotonic() - t0) * 1000)

    sim.current_tick = tick
    interactions = [
        {"participants": s["participants"], "narrative": s["narrative"], "intents": s.get("intents", [])}
        for s in scenes
    ]
    simtick = SimTick(
        id=str(uuid.uuid4()),
        simulation_id=sim.id,
        project_id=sim.project_id,
        tick=tick,
        interactions=interactions,
        mutations=applied_mutations,
        snapshot=snapshot,
        metrics=metrics,
    )
    db.add(simtick)
    await db.commit()
    await db.refresh(simtick)
    return simtick
