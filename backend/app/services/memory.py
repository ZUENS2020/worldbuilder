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
) -> str:
    """Build the memory context text for an Actor: all long-term summaries +
    the most recent K uncompacted episodics. Compacted episodics are omitted
    (their content lives on in the summary)."""
    rows = await _load_agent_memories(db, simulation_id, entity_id)
    summaries = [m for m in rows if m.kind == "summary"]
    episodics = [m for m in rows if m.kind == "episodic" and not _is_compacted(m)]
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
