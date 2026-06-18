"""World Book (lorebook) — graph-anchored HARD retrieval (no RAG).

Injection = enabled **global** entries (always on, priority-sorted) + **entity-
scoped** entries whose attachment targets are in-scene (the selected + N-hop
neighbor ids the context builder already computed). Entries may also carry a
per-observer whitelist in ``properties.visible_to`` so a lore entry can be made
known only to certain agents (fog of war over knowledge, not just entities).

The whole block is truncated to a rough token budget; highest-priority entries
win when the budget is tight. Pure functions — no DB/graph access — so the
caller passes in the already-loaded WorldEntry rows.
"""

from typing import Iterable, Optional


def _enabled(entry) -> bool:
    return bool(getattr(entry, "enabled", 1))


def _entry_visible_to(entry, observer_id: Optional[str]) -> bool:
    """An entry is visible to everyone unless it pins a ``visible_to`` whitelist."""
    if observer_id is None:
        return True
    whitelist = (getattr(entry, "properties", None) or {}).get("visible_to")
    if not whitelist:
        return True
    return observer_id in whitelist


def select_entries(
    entries: Iterable,
    in_scene_ids: Iterable[str],
    *,
    observer_id: Optional[str] = None,
) -> list:
    """Pick the entries that apply, highest priority first.

    Global entries always apply; entity-scoped entries apply only when at least
    one of their ``entity_ids`` is in scene. Visibility-filtered for observer.
    """
    in_scene = set(in_scene_ids or [])
    chosen = []
    for e in entries:
        if not _enabled(e) or not _entry_visible_to(e, observer_id):
            continue
        scope = (getattr(e, "scope", "global") or "global")
        if scope == "global":
            chosen.append(e)
        elif scope == "entity":
            targets = set(getattr(e, "entity_ids", None) or [])
            if targets & in_scene:
                chosen.append(e)
    chosen.sort(key=lambda e: -(getattr(e, "priority", 0) or 0))
    return chosen


def build_injection(
    entries: Iterable,
    in_scene_ids: Iterable[str],
    *,
    observer_id: Optional[str] = None,
    token_budget: int = 1200,
) -> str:
    """Render the 【世界设定 World Book】 markdown block (or "" if nothing applies)."""
    chosen = select_entries(entries, in_scene_ids, observer_id=observer_id)
    blocks = []
    used = 0
    for e in chosen:
        content = (getattr(e, "content", "") or "").strip()
        if not content:
            continue
        title = (getattr(e, "title", "") or "").strip()
        block = f"◆ {title}\n{content}" if title else content
        cost = len(block) // 2  # rough token estimate, matches engine.py
        if blocks and used + cost > token_budget:
            break
        blocks.append(block)
        used += cost
    if not blocks:
        return ""
    return "【世界设定 World Book】\n" + "\n\n".join(blocks)
