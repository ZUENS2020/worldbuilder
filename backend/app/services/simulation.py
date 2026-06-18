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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Entity, Relation, Simulation, SimTick, WorldEntry
from app.graph.engine import graph_engine
from app.services import ai_service
from app.services import belief
from app.services.memory import append_memory, get_memory_block, maybe_compact


# ── config defaults ──────────────────────────────────────────────
DEFAULT_CONFIG = {
    "max_encounters_per_tick": 4,
    "allow_new_entities": False,
    "temperature": 0.8,
    "scheduler_strategy": "weighted",   # weighted | random
    "memory_recent_k": 8,
    "memory_compact_threshold": 12,
}


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


# ── public API ───────────────────────────────────────────────────

async def run_tick(db: AsyncSession, sim: Simulation) -> SimTick:
    """Advance the simulation one tick and persist a SimTick row."""
    t0 = time.monotonic()
    tick = (sim.current_tick or 0) + 1
    config = sim.config or {}
    recent_k = int(_cfg(sim, "memory_recent_k") or 8)
    threshold = int(_cfg(sim, "memory_compact_threshold") or 12)
    allow_new = bool(_cfg(sim, "allow_new_entities"))
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
        act = await ai_service.ai_act(
            ctx["system_injection"], [a.name, b.name], mem_blocks,
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

    # 3. Oracle adjudication (whole tick at once = oracle_merge conflict strategy)
    applied_mutations = []
    if scenes:
        catalog = [
            {"name": e.name, "type": e.type}
            for e in (graph_engine.entities.get(eid) for eid in graph_engine.project_entities.get(sim.project_id, set()))
            if e
        ]
        verdict = await ai_service.ai_adjudicate(
            scenes, catalog, allow_new_entities=allow_new, config=config,
        )
        metrics["llm_calls"] += 1
        # 4. apply mutations (dual-write)
        applied_mutations = await _apply_mutations(
            db, sim, verdict.get("mutations", []), verdict.get("new_entities", []),
        )
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
