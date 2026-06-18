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
import unicodedata
import uuid

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    Entity, Relation, Simulation, SimTick, WorldEntry, AgentMemory,
)
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
    "scheduler_mix_conflict": False,    # also stage one charged (enemy/stranger) pair per tick
    "memory_recent_k": 8,
    "memory_compact_threshold": 12,
    "generate_events": True,          # Oracle crystallizes significant happenings into event nodes
    "event_min_significance": 0.5,    # only events at/above this significance become nodes
    "event_dedupe": True,             # LLM semantic dedupe against recent events/pending
    # 推演 (causal forward-deduction of pending events)
    "pending_max_age": 8,             # force-resolve a pending event this many ticks after registration (0 = off)
    # P5 background loop / stop conditions
    "tick_interval_sec": 6,           # seconds between ticks when running in the background
    "max_ticks": 0,                   # 0 = unlimited; otherwise auto-pause at this tick
    "stability_window": 0,            # 0 = off; auto-pause after N consecutive zero-mutation ticks
    # P5 heuristic perturbation (nudge / muse) — decision 12 (off by default)
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


def _cfg(sim: Simulation, key: str):
    return (sim.config or {}).get(key, DEFAULT_CONFIG.get(key))


async def _release_db_lock(db: AsyncSession, *objs) -> None:
    """Commit pending writes before slow LLM calls so other requests aren't blocked."""
    await db.commit()
    for obj in objs:
        if obj is not None:
            await db.refresh(obj)


def _verdict_has_substance(verdict: dict) -> bool:
    return bool(verdict.get("mutations")) or bool(verdict.get("events")) or bool(verdict.get("new_entities"))


def _mechanical_oracle_fallback(scenes: list[dict]) -> dict:
    """Minimal mutations when the LLM Oracle returns empty for non-empty scenes."""
    mutations: list[dict] = []
    seen_pairs: set[frozenset] = set()
    for s in scenes:
        names = s.get("participants") or []
        if len(names) >= 2:
            key = frozenset(names[:2])
            if key not in seen_pairs:
                seen_pairs.add(key)
                mutations.append({
                    "op": "update_relation",
                    "source": names[0], "target": names[1],
                    "weight_delta": 0.05,
                })
        for it in s.get("intents") or []:
            actor = (it.get("actor") or "").strip()
            summary = (it.get("summary") or "").strip()
            if actor and summary:
                mutations.append({
                    "op": "update_entity",
                    "entity": actor,
                    "properties": {"goal": summary[:240]},
                })
    return {"mutations": mutations, "new_entities": [], "events": []}


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

    # Optional structural mixing: weighted scheduling under-samples conflict
    # (low-weight pairs rarely meet), yet enemies/rivals do cross paths. Seed one
    # charged encounter ahead of the organic pairs. This is structural, not
    # orchestration — it picks WHO meets, never what happens.
    if _cfg(sim, "scheduler_mix_conflict"):
        charged = _charged_pairs(pid, char_ids, rel_pairs, 1)
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


_CHARGED_TYPES = {"enemy", "rival"}


def _charged_pairs(pid: str, char_ids: list[str], rel_pairs: dict, k: int) -> list[tuple[str, str]]:
    """Pick up to k 'charged' pairs (enemy/rival/low-weight first, then strangers)
    so the scheduler doesn't starve conflict. `rel_pairs` is {frozenset(a,b): weight}."""
    if k <= 0 or len(char_ids) < 2:
        return []
    hot: list[frozenset] = []
    for key, w in rel_pairs.items():
        a, b = tuple(key)
        rel = _find_relation(pid, a, b)
        rtype = rel.type if rel else ""
        if rtype in _CHARGED_TYPES or (w is not None and w <= 0.3):
            hot.append(key)
    random.shuffle(hot)
    out: list[tuple[str, str]] = [tuple(key) for key in hot[:k]]
    if len(out) < k:
        existing = set(rel_pairs.keys())
        tries = 0
        while len(out) < k and tries < 40:
            tries += 1
            a, b = random.sample(char_ids, 2)
            key = frozenset((a, b))
            if key in existing or key in {frozenset(p) for p in out}:
                continue
            out.append((a, b))
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


def _norm_name(name: str) -> str:
    """Canonicalize an entity name for fuzzy identity matching: NFKC folds
    full-width ↔ half-width punctuation (（）↔(), ·↔·) and digits, so an LLM that
    rewrites `天皇赏(春)` as `天皇赏（春）` still resolves to the same node instead of
    spawning a near-duplicate."""
    return unicodedata.normalize("NFKC", name or "").strip()


def _find_event_by_name(name: str, name_idx: dict[str, Entity]) -> Entity | None:
    """Locate an existing event by name — exact first, then NFKC-normalized — so
    register/dedup don't fork on punctuation-width drift."""
    e = name_idx.get(name)
    if e is not None and e.type == "event":
        return e
    target = _norm_name(name)
    for cand in name_idx.values():
        if cand.type == "event" and _norm_name(cand.name) == target:
            return cand
    return None


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


def _is_duplicate_sim_event(pid: str, sim_id: str, name: str) -> bool:
    """Exact-name guard (LLM semantic dedupe runs earlier; this catches same-tick dupes)."""
    target = _norm_name(name)
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event" or _norm_name(e.name) != target:
            continue
        meta = (e.properties or {}).get("_sim")
        if isinstance(meta, dict) and meta.get("sim_id") == sim_id:
            return True
    return False


def _event_dedupe_corpus(pid: str, sim_id: str, *, limit: int = 35) -> list[dict]:
    """Recent resolved + active pending events for LLM dedupe context."""
    scored: list[tuple[int, dict]] = []
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event":
            continue
        props = e.properties or {}
        status = props.get("status")
        if status not in ("pending", "resolved"):
            continue
        meta = _event_sim_meta(e)
        owner = meta.get("sim_id")
        if owner and owner != sim_id:
            continue
        tick = (
            props.get("resolved_tick")
            or meta.get("registered_tick")
            or meta.get("tick")
            or 0
        )
        tick_i = int(tick) if isinstance(tick, (int, float)) else 0
        detail = props.get("stakes") or props.get("description") or ""
        scored.append((tick_i, {
            "name": e.name,
            "status": status,
            "stakes": detail,
            "summary": props.get("description") or "",
            "description": detail,
            "tick": tick_i,
        }))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [row for _, row in scored[:limit]]


async def _llm_dedupe_candidates(
    db: AsyncSession,
    sim: Simulation,
    candidates: list[dict],
    metrics: dict,
) -> list[dict]:
    """Filter event/pending candidates through one LLM semantic dedupe pass."""
    if not candidates or not _cfg(sim, "event_dedupe"):
        return candidates
    corpus = _event_dedupe_corpus(sim.project_id, sim.id)
    if not corpus:
        return candidates
    await _release_db_lock(db, sim)
    filtered = await ai_service.ai_filter_event_duplicates(
        candidates, corpus, config=sim.config or {},
    )
    skipped = len(candidates) - len(filtered)
    if skipped:
        metrics["dedupe_llm_skipped"] = metrics.get("dedupe_llm_skipped", 0) + skipped
    metrics["llm_calls"] = metrics.get("llm_calls", 0) + 1
    return filtered


async def _apply_events(
    db: AsyncSession, sim: Simulation, events: list[dict], tick: int, min_significance: float,
) -> list[dict]:
    """Crystallize the Oracle's significant happenings into `event` entity nodes,
    wiring each to its participants (`participated`) and to the previous sim event
    (`followed_by`). These are facts that already happened → status='resolved'.
    Dual-written to DB + graph_engine like every other mutation."""
    pid = sim.project_id
    applied: list[dict] = []
    name_idx = _name_index(pid)
    prev_event = _latest_sim_event(pid, sim.id, before_tick=tick)
    dedupe = bool(_cfg(sim, "event_dedupe"))

    for ev in events:
        name = (ev.get("name") or "").strip()
        if not name:
            continue
        if dedupe and _is_duplicate_sim_event(pid, sim.id, name):
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
                "status": "resolved",
                "resolved_tick": tick,
                "_sim": {"sim_id": sim.id, "tick": tick, "significance": sig, "resolved_tick": tick},
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
        if prev_event is not None and prev_event.id != event.id:
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


# ── ripeness helpers (preset discipline + autonomous pending) ────

_CONFLICT_REL_TYPES = frozenset({"enemy", "rival"})
_FUTURE_INTENT_MARKERS = (
    "今晚", "明日", "后天", "必须", "要让他", "要让她", "打算", "计划",
    "准备", "即将", "将要", "一定要", "务必",
)


def _pending_sequence_gate(pending: list[Entity]) -> set[str]:
    """Among pending events, only those at the minimum sequence_order (if any)
    may resolve. Events without sequence_order are always eligible."""
    orders = [
        int((e.properties or {}).get("sequence_order"))
        for e in pending
        if isinstance((e.properties or {}).get("sequence_order"), (int, float))
    ]
    if not orders:
        return {e.name for e in pending}
    min_order = min(orders)
    allowed: set[str] = set()
    for e in pending:
        o = (e.properties or {}).get("sequence_order")
        if o is None or int(o) == min_order:
            allowed.add(e.name)
    return allowed


def _oracle_ripe_allowed(event: Entity, tick: int) -> bool:
    """Oracle cannot mark a preset ripe before its due_tick."""
    due = (event.properties or {}).get("due_tick")
    if isinstance(due, (int, float)) and tick < int(due):
        return False
    return True


def _filter_oracle_ripe_names(
    ripe_names: list[str], pending: list[Entity], tick: int, scenes: list[dict],
) -> tuple[set[str], int]:
    """Apply due_tick floor and narrative name-presence heuristic."""
    pending_by_name = {e.name: e for e in pending}
    scene_text = "\n".join((s.get("narrative") or "") for s in scenes)
    out: set[str] = set()
    filtered = 0
    for raw in ripe_names or []:
        name = (raw or "").strip()
        if not name:
            continue
        e = pending_by_name.get(name)
        if e is None:
            continue
        if not _oracle_ripe_allowed(e, tick):
            filtered += 1
            continue
        due = (e.properties or {}).get("due_tick")
        if isinstance(due, (int, float)) and tick < int(due) and name not in scene_text:
            filtered += 1
            continue
        out.add(name)
    return out, filtered


def _ripe_reason(
    event: Entity, tick: int, ripe_names: set[str], max_age: int,
) -> str | None:
    """Why this pending event is ripe this tick, or None."""
    if event.name in ripe_names and _oracle_ripe_allowed(event, tick):
        return "oracle"
    props = event.properties or {}
    due = props.get("due_tick")
    if isinstance(due, (int, float)) and tick >= int(due):
        return "due_tick"
    if max_age and max_age > 0:
        reg_tick = _event_sim_meta(event).get("registered_tick")
        if isinstance(reg_tick, (int, float)) and (tick - int(reg_tick)) >= max_age:
            return "max_age"
    return None


def _mechanical_resolve_fallback(event: Entity, world_state: str, tick: int) -> dict:
    """Guarantee a non-empty outcome when due_tick / max_age forces resolution."""
    props = event.properties or {}
    stakes = (props.get("stakes") or props.get("description") or "").strip()
    base = stakes[:160] if stakes else "各方按当前力量对比与处境推进"
    outcome = f"{event.name}已发生并落定：{base}。"
    consequences: list[dict] = []
    return {"outcome": outcome, "consequences": consequences}


def _project_characters(pid: str) -> list[Entity]:
    return [
        e for e in graph_engine.get_project_entities(pid)
        if e.type == "character"
    ]


def _character_goals_catalog(pid: str) -> list[dict]:
    return [
        {"name": e.name, "goal": (e.properties or {}).get("goal") or ""}
        for e in _project_characters(pid)
        if (e.properties or {}).get("goal")
    ]


def _scan_goal_conflicts(pid: str) -> list[dict]:
    """Find character pairs with charged relations and both have goals."""
    chars = _project_characters(pid)
    by_id = {c.id: c for c in chars}
    char_set = set(by_id)
    seen: set[frozenset] = set()
    out: list[dict] = []
    for r in graph_engine.get_project_relations(pid):
        if r.source_id not in char_set or r.target_id not in char_set:
            continue
        if r.type not in _CONFLICT_REL_TYPES:
            continue
        key = frozenset((r.source_id, r.target_id))
        if key in seen:
            continue
        seen.add(key)
        a, b = by_id[r.source_id], by_id[r.target_id]
        ga = (a.properties or {}).get("goal") or ""
        gb = (b.properties or {}).get("goal") or ""
        if not ga or not gb:
            continue
        short_a = ga[:24].rstrip("，。；")
        short_b = gb[:24].rstrip("，。；")
        name = f"{a.name}与{b.name}的博弈"
        stakes = f"{a.name}（{ga[:80]}）与{b.name}（{gb[:80]}）目标冲突，须见分晓。"
        out.append({"name": name, "stakes": stakes, "participants": [a.name, b.name]})
    return out[:3]


def _intents_suggest_pending(scenes: list[dict]) -> list[dict]:
    """Mechanical fallback: future-oriented intents → one pending registration."""
    for s in scenes:
        for it in s.get("intents") or []:
            summary = (it.get("summary") or "").strip()
            actor = (it.get("actor") or "").strip()
            if not summary or not actor:
                continue
            if not any(m in summary for m in _FUTURE_INTENT_MARKERS):
                continue
            name = summary[:20].rstrip("，。；")
            if len(name) < 4:
                name = f"{actor}的布局"
            parts = list(s.get("participants") or [])
            return [{
                "name": name,
                "stakes": summary[:120],
                "participants": parts[:4],
            }]
    return []


async def _ensure_future_pending(
    db: AsyncSession,
    sim: Simulation,
    tick: int,
    scenes: list[dict],
    catalog: list[dict],
    config: dict,
    metrics: dict,
    *,
    already_registered: bool,
) -> list[dict]:
    """When pending queue is empty, seed new悬决 from goal conflicts or intents."""
    if _active_pending_events(sim.project_id, sim.id):
        return []
    if already_registered:
        return []

    metrics["pending_drought"] = True
    candidates = _scan_goal_conflicts(sim.project_id)
    if not candidates:
        candidates = _intents_suggest_pending(scenes)
    if not candidates:
        return []

    applied: list[dict] = []
    # Try LLM-assisted registration first when we have scene context.
    if scenes and candidates:
        goal_lines = "\n".join(
            f"- {c['name']}：{c['stakes']}" for c in candidates[:2]
        )
        directive = (
            "当前无悬决事件。请根据以下角色目标冲突，用 register_pending_event "
            f"登记至少 1 件尚未发生的未来之事：\n{goal_lines}"
        )
        dedupe_corpus = _event_dedupe_corpus(sim.project_id, sim.id)
        await _release_db_lock(db, sim)
        verdict = await ai_service.ai_adjudicate(
            scenes, catalog, generate_events=False,
            pending_events=None,
            character_goals=_character_goals_catalog(sim.project_id),
            recent_events=dedupe_corpus or None,
            directive=directive, config=config, temperature=0.3,
        )
        metrics["llm_calls"] = metrics.get("llm_calls", 0) + 1
        register_ops = [
            m for m in (verdict.get("mutations") or [])
            if m.get("op") == "register_pending_event"
        ]
        if register_ops:
            reg_cands = [
                {"name": m.get("name"), "stakes": m.get("stakes", ""), "kind": "pending"}
                for m in register_ops if (m.get("name") or "").strip()
            ]
            kept = await _llm_dedupe_candidates(db, sim, reg_cands, metrics)
            keep_names = {_norm_name(c.get("name", "")) for c in kept}
            register_ops = [
                m for m in register_ops
                if _norm_name(m.get("name", "")) in keep_names
            ]
        if register_ops:
            applied = await _register_pending_events(db, sim, register_ops[:2], tick)
            metrics["pending_registered_from_drought"] = len(applied)
            return applied

    # Mechanical fallback.
    mech = await _llm_dedupe_candidates(
        db, sim, [{**c, "kind": "pending"} for c in candidates[:1]], metrics,
    )
    applied = await _register_pending_events(db, sim, mech, tick)
    metrics["pending_registered_from_drought"] = len(applied)
    return applied


# ── 推演 (causal forward-deduction of pending events) ────────────

def _event_sim_meta(e: Entity) -> dict:
    meta = (e.properties or {}).get("_sim")
    return meta if isinstance(meta, dict) else {}


def _active_pending_events(pid: str, sim_id: str) -> list[Entity]:
    """All event nodes currently in `pending` status that this sim should act on:
    sim-registered ones (matching sim_id) AND user-preset ones (no `_sim` marker,
    so they belong to the project baseline and apply to every sim)."""
    out: list[Entity] = []
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event":
            continue
        if (e.properties or {}).get("status") != "pending":
            continue
        meta = _event_sim_meta(e)
        owner = meta.get("sim_id")
        if owner and owner != sim_id:
            continue  # belongs to a different sim
        out.append(e)
    return out


def _event_participants(pid: str, event: Entity) -> list[Entity]:
    """Characters tied to an event — via `participated` edges, falling back to the
    `participant_names` property for preset events that have no edges yet."""
    chars: list[Entity] = []
    seen: set[str] = set()
    for r in graph_engine.adjacency.get(event.id, []):
        if r.type != "participated":
            continue
        other_id = r.source_id if r.target_id == event.id else r.target_id
        e = graph_engine.entities.get(other_id)
        if e and e.type == "character" and e.id not in seen:
            seen.add(e.id)
            chars.append(e)
    if not chars:
        idx = _name_index(pid)
        for pname in (event.properties or {}).get("participant_names", []) or []:
            e = idx.get(pname)
            if e and e.type == "character" and e.id not in seen:
                seen.add(e.id)
                chars.append(e)
    return chars


_STATE_KEYS = ("role", "title", "status", "power", "occupation", "goal", "mood")


def _event_world_state(pid: str, participants: list[Entity]) -> str:
    """A compact, factual snapshot of the participants' current canonical state —
    salient props + the relations among them — fed to `ai_resolve_event` so the
    outcome is derived from the world, not invented."""
    lines: list[str] = []
    for e in participants:
        props = e.properties or {}
        bits = [f"{k}：{props[k]}" for k in _STATE_KEYS if props.get(k)]
        lines.append(f"- {e.name}（{'、'.join(bits) if bits else '无显著属性'}）")
    # relations strictly among the participants
    pids = {e.id for e in participants}
    id2name = {e.id: e.name for e in participants}
    rel_lines: list[str] = []
    seen: set[frozenset] = set()
    for e in participants:
        for r in graph_engine.adjacency.get(e.id, []):
            if r.source_id in pids and r.target_id in pids:
                key = frozenset((r.source_id, r.target_id))
                if key in seen:
                    continue
                seen.add(key)
                rel_lines.append(
                    f"- {id2name.get(r.source_id, '?')} → {id2name.get(r.target_id, '?')}："
                    f"{r.type}（{(r.weight if r.weight is not None else 0.5):.2f}）"
                )
    out = "【参与者当前状态】\n" + "\n".join(lines)
    if rel_lines:
        out += "\n【相互关系】\n" + "\n".join(rel_lines)
    return out


def _recent_context_for(participants: list[Entity], scenes: list[dict]) -> str:
    """This tick's scene narratives that involve any participant — the immediate
    lead-up the resolver should account for."""
    names = {e.name for e in participants}
    chunks: list[str] = []
    for s in scenes:
        if names & set(s.get("participants") or []):
            nar = (s.get("narrative") or "").strip()
            if nar:
                chunks.append(f"（{'、'.join(s['participants'])}）{nar}")
    return "\n\n".join(chunks)


async def _wire_participants(
    db: AsyncSession, pid: str, event: Entity, names: list, name_idx: dict
) -> None:
    """Add `participated` edges from named characters to an event, skipping any
    that already exist so promotion is idempotent."""
    existing = {
        (r.source_id if r.target_id == event.id else r.target_id)
        for r in graph_engine.adjacency.get(event.id, [])
        if r.type == "participated"
    }
    for pname in names or []:
        actor = name_idx.get(pname)
        if not actor or actor.type != "character" or actor.id in existing:
            continue
        rel = Relation(
            id=str(uuid.uuid4()), source_id=actor.id, target_id=event.id,
            type="participated", weight=0.5, properties={}, project_id=pid,
        )
        db.add(rel)
        await db.flush()
        graph_engine.add_relation(rel)
        existing.add(actor.id)


async def _register_pending_events(
    db: AsyncSession, sim: Simulation, regs: list[dict], tick: int
) -> list[dict]:
    """Materialize Oracle `register_pending_event` ops into `status=pending` event
    nodes, wiring participants via `participated`.

    A same-name event already in the graph is handled by status:
      - resolved  → skip (it already happened);
      - pending   → skip (already in the lifecycle);
      - dormant (no/other status) → **promote** it into the lifecycle in place.

    Promotion is the loop-breaker for author-preset or pre-refactor events that
    exist as plain `status=None` nodes: the actors circle them forever, but without
    a lifecycle handle the engine could never resolve them ("eternal eve"). Now the
    Oracle can adopt such a dormant event into pending and the resolver crosses it."""
    pid = sim.project_id
    applied: list[dict] = []
    name_idx = _name_index(pid)
    for reg in regs:
        name = (reg.get("name") or "").strip()
        if not name:
            continue
        stakes = reg.get("stakes", "")
        due = reg.get("due_tick")
        due_int = int(due) if isinstance(due, (int, float)) and due > 0 else None

        existing = _find_event_by_name(name, name_idx)
        if existing is not None:
            status = (existing.properties or {}).get("status")
            if status in ("pending", "resolved"):
                continue  # already in (or past) the lifecycle
            # Dormant event → promote in place rather than dropping the op.
            props = dict(existing.properties or {})
            props["status"] = "pending"
            if stakes:
                props["stakes"] = stakes
                if not props.get("description"):
                    props["description"] = stakes
            if due_int is not None:
                props["due_tick"] = due_int
            meta = props.get("_sim") if isinstance(props.get("_sim"), dict) else {}
            props["_sim"] = {**meta, "sim_id": sim.id, "tick": tick, "registered_tick": tick}
            ev_row = await db.get(Entity, existing.id)
            if ev_row:
                ev_row.properties = props      # DB row
            existing.properties = props        # in-memory graph mirror
            await _wire_participants(db, pid, existing, reg.get("participants", []), name_idx)
            applied.append({"op": "register_pending_event", "name": existing.name,
                            "stakes": props.get("stakes", ""), "tick": tick,
                            "promoted": True})
            continue

        final_name = name
        n = 2
        while final_name in name_idx:
            final_name = f"{name}（{n}）"
            n += 1
        props = {
            "description": stakes,
            "stakes": stakes,
            "status": "pending",
            "time": f"t{tick}",
            "_sim": {"sim_id": sim.id, "tick": tick, "registered_tick": tick},
        }
        if due_int is not None:
            props["due_tick"] = due_int
        event = Entity(
            id=str(uuid.uuid4()), name=final_name, type="event",
            properties=props, project_id=pid,
        )
        db.add(event)
        await db.flush()
        graph_engine.add_entity(event)
        name_idx[final_name] = event
        applied.append({"op": "register_pending_event", "name": final_name,
                        "stakes": stakes, "tick": tick})
        await _wire_participants(db, pid, event, reg.get("participants", []), name_idx)
    return applied


def _pending_is_ripe(
    event: Entity, tick: int, ripe_names: set[str], max_age: int,
) -> bool:
    return _ripe_reason(event, tick, ripe_names, max_age) is not None


async def _resolve_ripe_events(
    db: AsyncSession, sim: Simulation, ripe_names: list[str], tick: int,
    config: dict, scenes: list[dict], metrics: dict,
) -> list[dict]:
    """The heart of 推演: for each ripe pending event, derive an outcome causally
    from current world state (no director), flip it to resolved, apply the
    consequences via the normal mutation path, chain a `followed_by` edge, and lodge
    a high-salience 【已发生】 memory so the next tick plays the aftermath, not the
    eternal eve."""
    pid = sim.project_id
    applied: list[dict] = []
    max_age = int(_cfg(sim, "pending_max_age") or 0)
    pending = _active_pending_events(pid, sim.id)
    ripe_set, filtered = _filter_oracle_ripe_names(ripe_names, pending, tick, scenes)
    if filtered:
        metrics["ripe_filtered"] = filtered
    allowed_names = _pending_sequence_gate(pending)
    to_resolve = [
        e for e in pending
        if e.name in allowed_names and _pending_is_ripe(e, tick, ripe_set, max_age)
    ]
    if not to_resolve:
        return applied

    prev_event = _latest_sim_event(pid, sim.id, before_tick=tick + 1)
    for event in to_resolve:
        reason = _ripe_reason(event, tick, ripe_set, max_age)
        participants = _event_participants(pid, event)
        stakes = (event.properties or {}).get("stakes") or (event.properties or {}).get("description") or ""
        world_state = _event_world_state(pid, participants)
        recent = _recent_context_for(participants, scenes)
        await _release_db_lock(db, sim)
        resolution = await ai_service.ai_resolve_event(
            event.name, stakes, world_state, recent, config=config,
        )
        metrics["llm_calls"] = metrics.get("llm_calls", 0) + 1
        outcome = (resolution.get("outcome") or "").strip()
        if not outcome and reason in ("due_tick", "max_age"):
            resolution = _mechanical_resolve_fallback(event, world_state, tick)
            outcome = (resolution.get("outcome") or "").strip()
            metrics["resolve_fallback"] = "mechanical"
        if not outcome:
            continue

        # Flip to resolved (dual-write).
        ev_row = await db.get(Entity, event.id)
        if ev_row:
            props = dict(ev_row.properties or {})
            props["status"] = "resolved"
            props["outcome"] = outcome
            props["resolved_tick"] = tick
            meta = dict(props.get("_sim") or {})
            meta["resolved_tick"] = tick
            if not meta.get("sim_id"):
                meta["sim_id"] = sim.id  # claim preset events for this sim's history
            props["_sim"] = meta
            ev_row.properties = props
            event.properties = props
        applied.append({"op": "resolve_event", "name": event.name, "tick": tick,
                        "outcome": outcome})

        # Apply the derived consequences through the normal mutation path.
        consequences = resolution.get("consequences") or []
        if consequences:
            applied.extend(await _apply_mutations(db, sim, consequences, []))

        # Refresh participant goals in light of the settlement.
        for pe in participants:
            pe_ent = graph_engine.entities.get(pe.id) or pe
            truth = {k: (pe_ent.properties or {}).get(k) for k in ("goal", "mood", "role", "status")
                       if (pe_ent.properties or {}).get(k)}
            if truth:
                await belief.reconcile_belief(
                    db, sim, pe.id, pe.id, truth, config=config,
                )
                metrics["llm_calls"] = metrics.get("llm_calls", 0) + 1

        # Temporal chain: previous sim event → this resolution.
        if prev_event is not None and prev_event.id != event.id:
            rel = Relation(
                id=str(uuid.uuid4()), source_id=prev_event.id, target_id=event.id,
                type="followed_by", weight=0.6, properties={}, project_id=pid,
            )
            db.add(rel)
            await db.flush()
            graph_engine.add_relation(rel)
        prev_event = event

        # High-salience aftermath memory — this is what breaks the eternal-eve loop.
        for pe in participants:
            await append_memory(
                db, project_id=pid, simulation_id=sim.id, entity_id=pe.id,
                tick=tick, content=f"【已发生】{event.name}。结果：{outcome}",
                participants=[o.name for o in participants if o.id != pe.id],
                salience=0.9,
            )
        await db.flush()

    metrics["resolved_events"] = metrics.get("resolved_events", 0) + len(
        [o for o in applied if o.get("op") == "resolve_event"]
    )
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
    beliefs = await belief.snapshot_beliefs(db, sim)
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

    # Wipe derived state: this sim's beliefs, memories, ticks > 0.
    await belief.clear_sim_beliefs(db, sim.id)
    await db.execute(delete(AgentMemory).where(AgentMemory.simulation_id == sim.id))
    await db.execute(delete(SimTick).where(SimTick.simulation_id == sim.id, SimTick.tick > 0))

    sim.current_tick = 0
    sim.status = "idle"
    await db.flush()

    # Rebuild the in-memory mirror from the restored DB rows.
    if baseline:
        await _reload_project_graph(db, pid)

    await belief.seed_beliefs(db, sim)
    await db.commit()

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
        await belief.refresh_encounter_beliefs(db, sim, tick, a_id, b_id)
        ctx = await belief.build_actor_context(
            db, sim, a_id, b_id, world_entries=world_entries, recent_k=recent_k,
        )
        mem_blocks = {
            a.name: await get_memory_block(db, simulation_id=sim.id, entity_id=a_id, recent_k=recent_k),
            b.name: await get_memory_block(db, simulation_id=sim.id, entity_id=b_id, recent_k=recent_k),
        }
        scene_nudges = {
            name: nudges[name] for name in (a.name, b.name) if name in nudges
        }
        await _release_db_lock(db, sim)
        act = await ai_service.ai_act(
            ctx["system_injection"], [a.name, b.name], mem_blocks,
            nudges=scene_nudges or None,
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

    # 3. Oracle adjudication (whole tick at once = oracle_merge conflict strategy).
    #    The Oracle also sees the active pending events so it can judge which are
    #    now causally ripe (ripe_events) and register newly-orbited future events.
    applied_mutations: list[dict] = []
    tick_memories_unconfirmed = False
    pending_now = _active_pending_events(sim.project_id, sim.id)
    pending_list = [
        {"name": e.name, "stakes": (e.properties or {}).get("stakes")
         or (e.properties or {}).get("description") or ""}
        for e in pending_now
    ]
    verdict: dict = {}
    catalog = [
        {"name": e.name, "type": e.type}
        for e in (
            graph_engine.entities.get(eid)
            for eid in graph_engine.project_entities.get(sim.project_id, set())
        )
        if e
    ]
    goals_catalog = _character_goals_catalog(sim.project_id)
    dedupe_corpus = _event_dedupe_corpus(sim.project_id, sim.id)
    if scenes:
        await _release_db_lock(db, sim)
        verdict = await ai_service.ai_adjudicate(
            scenes, catalog, allow_new_entities=allow_new,
            generate_events=gen_events,
            pending_events=pending_list or None,
            character_goals=goals_catalog or None,
            recent_events=dedupe_corpus or None,
            config=config,
        )
        metrics["llm_calls"] += 1
        if not _verdict_has_substance(verdict):
            tick_memories_unconfirmed = True
            retry_directive = "本 tick 叙事非空，必须至少产出与叙事一致的 update_entity 或 update_relation 变更。"
            await _release_db_lock(db, sim)
            verdict = await ai_service.ai_adjudicate(
                scenes, catalog, allow_new_entities=allow_new,
                generate_events=gen_events,
                pending_events=pending_list or None,
                character_goals=goals_catalog or None,
                recent_events=dedupe_corpus or None,
                directive=retry_directive, config=config, temperature=0.3,
            )
            metrics["llm_calls"] += 1
            if _verdict_has_substance(verdict):
                metrics["oracle_fallback"] = "retry"
                tick_memories_unconfirmed = False
            else:
                verdict = _mechanical_oracle_fallback(scenes)
                metrics["oracle_fallback"] = "mechanical"
                metrics["oracle_empty_avoided"] = True
                tick_memories_unconfirmed = False

        # Event drought: nudge Oracle to produce events or new pending.
        register_ops_pre = [
            m for m in (verdict.get("mutations") or [])
            if m.get("op") == "register_pending_event"
        ]
        if (
            gen_events
            and not (verdict.get("events") or [])
            and not register_ops_pre
        ):
            drought_directive = (
                "本 tick 场景非空但无事件产出：请至少产出 1 条 events（已发生事实）"
                "或 1 条 register_pending_event（尚未发生的未来博弈）。"
            )
            eff_min_sig = max(0.25, event_min_sig - 0.1)
            metrics["event_min_sig_relaxed"] = eff_min_sig
            await _release_db_lock(db, sim)
            drought_verdict = await ai_service.ai_adjudicate(
                scenes, catalog, allow_new_entities=allow_new,
                generate_events=True,
                pending_events=pending_list or None,
                character_goals=goals_catalog or None,
                recent_events=dedupe_corpus or None,
                directive=drought_directive, config=config, temperature=0.35,
            )
            metrics["llm_calls"] += 1
            if drought_verdict.get("events"):
                verdict["events"] = drought_verdict["events"]
            extra_regs = [
                m for m in (drought_verdict.get("mutations") or [])
                if m.get("op") == "register_pending_event"
            ]
            if extra_regs:
                verdict.setdefault("mutations", []).extend(extra_regs)
            if not verdict.get("ripe_events") and drought_verdict.get("ripe_events"):
                verdict["ripe_events"] = drought_verdict["ripe_events"]

        # Split register_pending_event ops out of the regular mutation stream.
        raw_mutations = verdict.get("mutations", []) or []
        register_ops = [m for m in raw_mutations if m.get("op") == "register_pending_event"]
        plain_mutations = [m for m in raw_mutations if m.get("op") != "register_pending_event"]

        events_for_apply = list(verdict.get("events") or [])
        if gen_events and events_for_apply:
            event_cands = [
                {"name": e.get("name"), "summary": e.get("summary", ""), "kind": "crystallize"}
                for e in events_for_apply if (e.get("name") or "").strip()
            ]
            kept_events = await _llm_dedupe_candidates(db, sim, event_cands, metrics)
            keep_event_names = {_norm_name(c.get("name", "")) for c in kept_events}
            events_for_apply = [
                e for e in events_for_apply
                if _norm_name(e.get("name", "")) in keep_event_names
            ]

        if register_ops:
            reg_cands = [
                {"name": m.get("name"), "stakes": m.get("stakes", ""), "kind": "pending"}
                for m in register_ops if (m.get("name") or "").strip()
            ]
            kept_regs = await _llm_dedupe_candidates(db, sim, reg_cands, metrics)
            keep_reg_names = {_norm_name(c.get("name", "")) for c in kept_regs}
            register_ops = [
                m for m in register_ops
                if _norm_name(m.get("name", "")) in keep_reg_names
            ]

        # 4. apply mutations (dual-write)
        applied_mutations.extend(await _apply_mutations(
            db, sim, plain_mutations, verdict.get("new_entities", []),
        ))
        # 4b. crystallize significant happenings into resolved event nodes
        if gen_events:
            event_ops = await _apply_events(
                db, sim, events_for_apply, tick, event_min_sig,
            )
            applied_mutations.extend(event_ops)
            metrics["events"] = sum(1 for o in event_ops if o.get("op") == "create_event")

        # 4c. register newly-orbited future events as pending nodes
        if register_ops:
            reg_applied = await _register_pending_events(db, sim, register_ops, tick)
            applied_mutations.extend(reg_applied)
            metrics["pending_registered"] = len(reg_applied)

        # B3: intent fallback if Oracle missed future-oriented intents
        if not register_ops and not metrics.get("pending_registered"):
            intent_regs = _intents_suggest_pending(scenes)
            if intent_regs:
                intent_regs = await _llm_dedupe_candidates(
                    db, sim,
                    [{**r, "kind": "pending"} for r in intent_regs],
                    metrics,
                )
            if intent_regs:
                intent_applied = await _register_pending_events(db, sim, intent_regs[:1], tick)
                applied_mutations.extend(intent_applied)
                if intent_applied:
                    metrics["pending_registered_from_intent"] = len(intent_applied)

        # B2: seed new pending when queue is empty
        had_register = bool(
            register_ops or metrics.get("pending_registered")
            or metrics.get("pending_registered_from_intent")
        )
        drought_applied = await _ensure_future_pending(
            db, sim, tick, scenes, catalog, config, metrics,
            already_registered=had_register,
        )
        applied_mutations.extend(drought_applied)

    # 4d. 推演 — resolve ripe / due / max-age pending events from world state.
    resolve_ops = await _resolve_ripe_events(
        db, sim, verdict.get("ripe_events", []), tick,
        config, scenes, metrics,
    )
    applied_mutations.extend(resolve_ops)

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
            await _release_db_lock(db, sim)
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
                unconfirmed=tick_memories_unconfirmed,
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
