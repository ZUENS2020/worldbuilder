"""Per-agent episodic memory (append-only, never physically deleted).

Each tick, every participant gets an `episodic` row recording what they
experienced. When an agent accumulates more uncompacted episodics than
`memory_compact_threshold`, the oldest batch is folded into a single
`summary` row by the Oracle summarizer; the original rows are kept but
tagged `properties.compacted_into = <summary_id>` so replay can restore
the verbatim stream. Memory ≠ belief: this is the raw experience log.
"""

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import AgentMemory
from app.services.ai_service import ai_summarize_memory


# ── Multi-dimensional retrieval (after Generative Agents' `new_retrieve`) ──────
# Stanford GA scores each memory by recency·relevance·importance (normalized,
# weighted gw=[0.5, 3, 2]) and keeps the top-n. WorldBuilder's `salience`
# (≈importance) was already stored but never used for selection, and there was
# no relevance signal — retrieval was pure recency. We mirror GA's structure,
# but compute relevance with Chinese-safe substring / participant overlap
# instead of embeddings (GA itself ships an equivalent keyword path), so this
# adds NO new dependency. Retrieval only re-ranks what an Actor *recalls*; it
# never touches world state.

# Default weights mirror GA's gw = [recency 0.5, relevance 3, importance 2].
_DEFAULT_RETRIEVAL_WEIGHTS = {
    "recency_w": 0.5,
    "relevance_w": 3.0,
    "importance_w": 2.0,
    "recency_decay": 0.99,
}
# A participant whose name matches the focal partner is a strong relevance cue.
_PARTICIPANT_MATCH_BONUS = 1.0


def _recency_scores(episodics: list, decay: float) -> dict[str, float]:
    """`decay ** rank` over chronological order — the most recent memory scores
    highest. Mirrors GA `extract_recency`."""
    n = len(episodics)
    out: dict[str, float] = {}
    for i, m in enumerate(episodics):
        # i=0 is oldest; newest gets the smallest exponent → highest value.
        out[m.id] = decay ** (n - 1 - i)
    return out


def _importance_scores(episodics: list) -> dict[str, float]:
    """Use the already-stored `salience` (resolution aftermath 0.9 / scene 0.5).
    Mirrors GA `extract_importance` (which reads node.poignancy)."""
    return {m.id: float(m.salience if m.salience is not None else 0.5) for m in episodics}


def _relevance_scores(
    episodics: list, focal_terms: list[str], focal_participants: list[str],
) -> dict[str, float]:
    """Chinese-safe relevance without embeddings: fraction of focal terms that
    appear as substrings in the memory content, plus a bonus when the memory's
    participants intersect the focal partner(s)."""
    terms = [t for t in (focal_terms or []) if t]
    fp = {p for p in (focal_participants or []) if p}
    out: dict[str, float] = {}
    for m in episodics:
        content = m.content or ""
        if terms:
            hits = sum(1 for t in terms if t in content)
            score = hits / len(terms)
        else:
            score = 0.0
        if fp and fp.intersection(set(m.participants or [])):
            score += _PARTICIPANT_MATCH_BONUS
        out[m.id] = score
    return out


def _normalize_scores(d: dict[str, float]) -> dict[str, float]:
    """Scale values into [0, 1]. Mirrors GA `normalize_dict_floats` — when every
    value is equal (range 0) they all collapse to the midpoint 0.5."""
    if not d:
        return d
    vals = d.values()
    lo, hi = min(vals), max(vals)
    rng = hi - lo
    if rng == 0:
        return {k: 0.5 for k in d}
    return {k: (v - lo) / rng for k, v in d.items()}


def _score_memories(
    episodics: list,
    focal_terms: list[str],
    focal_participants: list[str],
    weights: dict | None = None,
) -> dict[str, float]:
    """Combined recency+relevance+importance score per memory id. Pure: no DB,
    no async — fed lightweight objects in tests. Mirrors GA `new_retrieve`'s
    `master_out` computation."""
    w = {**_DEFAULT_RETRIEVAL_WEIGHTS, **(weights or {})}
    rec = _normalize_scores(_recency_scores(episodics, float(w["recency_decay"])))
    rel = _normalize_scores(_relevance_scores(episodics, focal_terms, focal_participants))
    imp = _normalize_scores(_importance_scores(episodics))
    out: dict[str, float] = {}
    for m in episodics:
        out[m.id] = (
            float(w["recency_w"]) * rec.get(m.id, 0.0)
            + float(w["relevance_w"]) * rel.get(m.id, 0.0)
            + float(w["importance_w"]) * imp.get(m.id, 0.0)
        )
    return out


def _top_k_ids(scores: dict[str, float], k: int) -> set[str]:
    """The k highest-scoring ids. Mirrors GA `top_highest_x_values`."""
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]
    return {kid for kid, _ in ranked}


async def append_memory(
    db: AsyncSession,
    *,
    project_id: str,
    simulation_id: str,
    entity_id: str,
    tick: int,
    content: str,
    participants: list[str] | None = None,
    salience: float = 0.5,
    kind: str = "episodic",
    unconfirmed: bool = False,
) -> AgentMemory:
    """Write one memory row. Caller commits."""
    props: dict = {}
    if unconfirmed:
        props["unconfirmed"] = True
    row = AgentMemory(
        id=str(uuid.uuid4()),
        project_id=project_id,
        simulation_id=simulation_id,
        entity_id=entity_id,
        tick=tick,
        kind=kind,
        content=content,
        participants=participants or [],
        salience=salience,
        properties=props,
    )
    db.add(row)
    return row


async def _load_agent_memories(
    db: AsyncSession, simulation_id: str, entity_id: str
) -> list[AgentMemory]:
    rows = (
        await db.execute(
            select(AgentMemory)
            .where(AgentMemory.simulation_id == simulation_id)
            .where(AgentMemory.entity_id == entity_id)
            .order_by(AgentMemory.tick, AgentMemory.created_at)
        )
    ).scalars().all()
    return list(rows)


def _is_compacted(m: AgentMemory) -> bool:
    return bool((m.properties or {}).get("compacted_into"))


async def get_memory_block(
    db: AsyncSession,
    *,
    simulation_id: str,
    entity_id: str,
    recent_k: int = 8,
    focal_terms: list[str] | None = None,
    focal_participants: list[str] | None = None,
    weights: dict | None = None,
) -> str:
    """Build the memory context text for an Actor: all long-term summaries +
    the K most salient uncompacted episodics. Compacted episodics are omitted
    (their content lives on in the summary).

    Selection: when a focal (`focal_terms` / `focal_participants`) is given, the
    K episodics are chosen by GA-style recency+relevance+importance scoring
    (see `_score_memories`) — so a relevant-but-old memory can surface over
    irrelevant recent chatter. With no focal, behaviour is the legacy pure
    recency window (`episodics[-recent_k:]`). Either way they render in tick
    order for readability."""
    rows = await _load_agent_memories(db, simulation_id, entity_id)
    summaries = [m for m in rows if m.kind == "summary"]
    episodics = [m for m in rows if m.kind == "episodic" and not _is_compacted(m)]

    has_focal = bool(focal_terms) or bool(focal_participants)
    if has_focal and len(episodics) > recent_k:
        scores = _score_memories(episodics, focal_terms or [], focal_participants or [], weights)
        keep_ids = _top_k_ids(scores, recent_k)
        recent = [m for m in episodics if m.id in keep_ids]  # preserves tick order
    else:
        recent = episodics[-recent_k:]

    lines: list[str] = []
    if summaries:
        lines.append("【长期记忆（摘要）】")
        for s in summaries:
            lines.append(f"- {s.content}")
        lines.append("")
    if recent:
        lines.append("【近期经历】")
        for e in recent:
            who = "、".join(e.participants or []) if e.participants else ""
            prefix = f"(t{e.tick}" + (f", 与{who}" if who else "") + ") "
            body = e.content or ""
            if (e.properties or {}).get("unconfirmed"):
                body = f"（未证实）{body}"
            lines.append(f"- {prefix}{body}")
    return "\n".join(lines).strip()


async def maybe_compact(
    db: AsyncSession,
    *,
    simulation_id: str,
    project_id: str,
    entity_id: str,
    threshold: int,
    config: dict | None = None,
) -> AgentMemory | None:
    """If uncompacted episodics exceed `threshold`, fold the oldest half into a
    summary row. Returns the new summary row, or None if no compaction ran.
    Original episodics are NEVER deleted — only tagged compacted_into."""
    if threshold <= 0:
        return None
    rows = await _load_agent_memories(db, simulation_id, entity_id)
    episodics = [m for m in rows if m.kind == "episodic" and not _is_compacted(m)]
    if len(episodics) <= threshold:
        return None

    # Fold the oldest batch, keep the most recent `threshold//2` verbatim.
    # Skip unconfirmed episodics from compaction batches (keep them verbatim longer).
    compactable = [m for m in episodics if not (m.properties or {}).get("unconfirmed")]
    if len(compactable) <= threshold:
        return None
    keep = max(1, threshold // 2)
    to_fold = compactable[:-keep]
    if not to_fold:
        return None

    existing_summaries = [m.content for m in rows if m.kind == "summary"]
    folded_text = "\n".join(
        f"(t{m.tick}) {m.content}" for m in to_fold
    )
    summary_text = await ai_summarize_memory(
        prior_summary="\n".join(existing_summaries),
        episodics_text=folded_text,
        config=config,
    )

    summary = AgentMemory(
        id=str(uuid.uuid4()),
        project_id=project_id,
        simulation_id=simulation_id,
        entity_id=entity_id,
        tick=to_fold[-1].tick,
        kind="summary",
        content=summary_text,
        participants=[],
        salience=0.8,
        properties={"folds": len(to_fold)},
    )
    db.add(summary)
    for m in to_fold:
        props = dict(m.properties or {})
        props["compacted_into"] = summary.id
        m.properties = props
    return summary
