"""Drama enhancement layer — make the simulation produce big, dramatic conflict
instead of an endless stream of bland small-talk.

Four independently switchable mechanisms, all scaled by one master dial
`drama_intensity` (0~1):

  1. 轻量调优 (lightweight tuning) — `drama_actor` / `drama_oracle` / `drama_scheduler`
     Actor & Oracle prompts are told to allow decisive action and conflict (the
     magnitude scales with intensity); the scheduler deliberately throws enemies
     and strangers together. Implemented in ai_service (prompts) + here (pairs).

  2. 事件注入器 (event injector) — `drama_event_injector`
     Every N ticks an external shock (crisis / third party / scarcity / deadline)
     is injected into the scene and crystallized as an event node.

  3. 张力累积 (tension accumulation) — `drama_tension`
     Charged relations (enemy / rival / very low weight) accumulate tension each
     tick they meet without a real change; over threshold they're flagged to
     EXPLODE next tick (a forced dramatic turn handed to the Oracle).

  4. 导演 Agent (director) — `drama_director`
     A global stage-director reviews the world every N ticks and issues a "stage
     direction" — which conflict arc to escalate — injected into later scenes.

Per-sim transient state (director note, pending explosions) lives in module-level
dicts keyed by sim.id, mirroring sim_runner. Tension itself is persisted on the
relation's properties (`_tension`) so it survives restarts and clears on reset.
"""

import random

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Relation
from app.graph.engine import graph_engine
from app.services import ai_service


# ── per-sim transient state ──────────────────────────────────────
_director_note: dict[str, str] = {}            # sim_id -> latest stage direction
_pending_explosions: dict[str, set] = {}        # sim_id -> set[frozenset[name,name]]

_CHARGED_TYPES = {"enemy", "rival"}
_DRAMA_KEYS = (
    "drama_actor", "drama_oracle", "drama_scheduler",
    "drama_event_injector", "drama_tension", "drama_director",
)

# Drama-config defaults, merged into simulation.DEFAULT_CONFIG.
DEFAULTS = {
    "drama_intensity": 0.3,          # 0~1 master dial — scales every mechanism below
    "drama_actor": False,            # Actor: encourage decisive action / conflict / turns
    "drama_oracle": False,           # Oracle: relax weight cap, allow ruptures & flips
    "drama_scheduler": False,        # Scheduler: deliberately mix enemies & strangers
    "drama_event_injector": False,   # inject external shocks
    "drama_event_every_n": 3,        # ...every N ticks
    "drama_tension": False,          # accumulate tension → forced explosions
    "drama_tension_threshold": 1.0,  # explode at/above this accumulated tension
    "drama_director": False,         # global stage-director arc orchestration
    "drama_director_every_n": 4,     # ...reviews every N ticks
}


def _cfg(sim, key):
    return (sim.config or {}).get(key, DEFAULTS.get(key))


def level(sim) -> float:
    """Master intensity dial, clamped to 0~1."""
    try:
        return max(0.0, min(1.0, float(_cfg(sim, "drama_intensity"))))
    except (TypeError, ValueError):
        return 0.0


def on(sim, key: str) -> bool:
    return bool(_cfg(sim, key))


def any_on(sim) -> bool:
    return any(on(sim, k) for k in _DRAMA_KEYS)


def actor_level(sim) -> float:
    return level(sim) if on(sim, "drama_actor") else 0.0


def oracle_level(sim) -> float:
    return level(sim) if on(sim, "drama_oracle") else 0.0


def clear_state(sim_id: str) -> None:
    """Drop transient director / explosion state (called on reset)."""
    _director_note.pop(sim_id, None)
    _pending_explosions.pop(sim_id, None)


# ── scheduler mixing ─────────────────────────────────────────────

def charged_pairs(pid: str, char_ids: list[str], rel_pairs: dict, k: int) -> list[tuple[str, str]]:
    """Pick up to k 'charged' pairs to force dramatic encounters:
    existing enemy/rival/low-weight relations first, then strangers (no relation).
    `rel_pairs` is the {frozenset(a,b): weight} map already built by the scheduler."""
    if k <= 0 or len(char_ids) < 2:
        return []

    # Existing relations that carry conflict potential.
    hot: list[frozenset] = []
    for key, w in rel_pairs.items():
        a, b = tuple(key)
        rel = _rel_between(pid, a, b)
        rtype = rel.type if rel else ""
        if rtype in _CHARGED_TYPES or (w is not None and w <= 0.3):
            hot.append(key)
    random.shuffle(hot)

    out: list[tuple[str, str]] = []
    for key in hot[:k]:
        out.append(tuple(key))

    # Top up with strangers (character pairs that share no relation yet).
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


# ── event injector ───────────────────────────────────────────────

_SEED_TYPES = [
    ("crisis", "一场突如其来的危机/灾难/威胁，迫使在场者立刻反应"),
    ("third_party", "一个第三方势力或外人介入，打破了原有的平衡"),
    ("scarcity", "某种关键资源/机会突然变得稀缺，引发争夺"),
    ("deadline", "一个迫在眉睫的时限或抉择，逼迫各方摊牌"),
    ("revelation", "一个隐藏的秘密/真相即将浮出水面，动摇彼此的信任"),
]


async def maybe_inject_event(db: AsyncSession, sim, tick: int, config: dict) -> dict | None:
    """Generate an external shock this tick (if injector on and it's due).
    Returns {headline, detail, participants, seed_type} or None. The caller threads
    it into scene context, salient memory, and an event node."""
    if not on(sim, "drama_event_injector"):
        return None
    every_n = max(1, int(_cfg(sim, "drama_event_every_n") or 3))
    if tick % every_n != 0:
        return None

    pid = sim.project_id
    chars = [
        e for eid in graph_engine.project_entities.get(pid, set())
        if (e := graph_engine.entities.get(eid)) and e.type == "character"
    ]
    if len(chars) < 2:
        return None

    seed_type, seed_desc = random.choice(_SEED_TYPES)
    # A few real names to anchor the shock in the actual cast.
    sample = random.sample(chars, min(4, len(chars)))
    cast = "、".join(e.name for e in sample)
    world_blurb = _world_blurb(pid)

    seed = await ai_service.ai_generate_drama_seed(
        seed_type, seed_desc, cast, world_blurb,
        intensity=level(sim), config=config,
    )
    if not seed or not seed.get("headline"):
        return None
    # Resolve participants against the real cast (fall back to the sampled names).
    name_set = {e.name for e in chars}
    parts = [n for n in (seed.get("participants") or []) if n in name_set]
    if not parts:
        parts = [e.name for e in sample[:2]]
    seed["participants"] = parts
    seed["seed_type"] = seed_type
    return seed


# ── tension accumulation ─────────────────────────────────────────

def consume_explosions(sim) -> set:
    """Return (and clear) the pairs flagged to explode this tick."""
    return _pending_explosions.pop(sim.id, set()) or set()


def _significant_for_pair(applied: list[dict], a_name: str, b_name: str) -> bool:
    """Did this tick's mutations land a *real* change on the a↔b relation?"""
    pair = {a_name, b_name}
    for m in applied:
        if m.get("op") not in ("update_relation", "create_relation"):
            continue
        if {m.get("source"), m.get("target")} != pair:
            continue
        if m.get("op") == "create_relation" or m.get("type"):
            return True
        w = m.get("weight")
        if w is not None:
            return True  # an explicit weight set is a decisive move
    return False


async def update_tension(
    db: AsyncSession, sim, scenes: list[dict], applied: list[dict],
) -> list[dict]:
    """After adjudication, accumulate/release tension on each scheduled pair.
    Charged pairs that met without a real change gain tension; a decisive change
    releases it. Over threshold → flagged to explode next tick (and reset).
    Returns a small log for the tick metrics/feed."""
    if not on(sim, "drama_tension"):
        return []
    pid = sim.project_id
    lvl = level(sim)
    threshold = float(_cfg(sim, "drama_tension_threshold") or 1.0)
    log: list[dict] = []
    flagged = _pending_explosions.setdefault(sim.id, set())

    for s in scenes:
        names = s.get("participants", [])
        ids = s.get("participant_ids", [])
        if len(ids) != 2:
            continue
        rel = _rel_between(pid, ids[0], ids[1])
        if rel is None:
            continue  # strangers carry no relation to store tension on yet
        released = _significant_for_pair(applied, names[0], names[1])
        rel_db = await db.get(Relation, rel.id)
        if rel_db is None:
            continue
        props = dict(rel_db.properties or {})
        cur = float(props.get("_tension") or 0.0)

        if released:
            new_t = 0.0
        else:
            charged = rel.type in _CHARGED_TYPES or (rel.weight or 0.5) <= 0.3
            inc = (0.3 if charged else 0.12) * (0.4 + lvl)
            new_t = cur + inc

        if new_t >= threshold:
            flagged.add(frozenset((names[0], names[1])))
            new_t = 0.0
            log.append({"op": "tension_explode", "source": names[0], "target": names[1]})

        props["_tension"] = round(new_t, 3)
        rel_db.properties = props
        rel.properties = props  # mirror into the in-memory graph
    return log


# ── director agent ───────────────────────────────────────────────

async def maybe_run_director(db: AsyncSession, sim, tick: int, config: dict) -> str | None:
    """Refresh the global stage direction every N ticks; return the active note
    (cached between refreshes). Returns None when the director is off."""
    if not on(sim, "drama_director"):
        return None
    every_n = max(1, int(_cfg(sim, "drama_director_every_n") or 4))
    cached = _director_note.get(sim.id)
    if tick % every_n != 0 and cached:
        return cached

    pid = sim.project_id
    note = await ai_service.ai_direct(
        _world_blurb(pid, top=10),
        _tension_blurb(pid),
        _recent_events_blurb(pid, sim.id),
        intensity=level(sim), config=config,
    )
    if note:
        _director_note[sim.id] = note
        return note
    return cached


# ── shared world summaries ───────────────────────────────────────

def _rel_between(pid: str, a_id: str, b_id: str) -> Relation | None:
    for r in graph_engine.adjacency.get(a_id, []):
        if r.project_id != pid:
            continue
        if {r.source_id, r.target_id} == {a_id, b_id}:
            return r
    return None


def _world_blurb(pid: str, top: int = 6) -> str:
    """A compact view of the strongest character↔character relations."""
    rels = []
    for r in graph_engine.get_project_relations(pid):
        a = graph_engine.entities.get(r.source_id)
        b = graph_engine.entities.get(r.target_id)
        if not a or not b or a.type != "character" or b.type != "character":
            continue
        rels.append((r.weight or 0.5, f"{a.name}—[{r.type}{(r.weight or 0.5):.1f}]—{b.name}"))
    rels.sort(key=lambda x: -x[0])
    return "；".join(s for _, s in rels[:top]) or "（关系网尚浅）"


def _tension_blurb(pid: str) -> str:
    hot = []
    seen = set()
    for r in graph_engine.get_project_relations(pid):
        t = float((r.properties or {}).get("_tension") or 0.0)
        if t <= 0:
            continue
        key = frozenset((r.source_id, r.target_id))
        if key in seen:
            continue
        seen.add(key)
        a = graph_engine.entities.get(r.source_id)
        b = graph_engine.entities.get(r.target_id)
        if a and b:
            hot.append((t, f"{a.name}↔{b.name}({t:.1f})"))
    hot.sort(key=lambda x: -x[0])
    return "、".join(s for _, s in hot[:6]) or "（暂无积压张力）"


def _recent_events_blurb(pid: str, sim_id: str, k: int = 5) -> str:
    evs = []
    for eid in graph_engine.project_entities.get(pid, set()):
        e = graph_engine.entities.get(eid)
        if not e or e.type != "event":
            continue
        meta = (e.properties or {}).get("_sim")
        if not isinstance(meta, dict) or meta.get("sim_id") != sim_id:
            continue
        evs.append((meta.get("tick", 0), e.name))
    evs.sort(key=lambda x: -x[0])
    return "、".join(n for _, n in evs[:k]) or "（尚无事件）"
