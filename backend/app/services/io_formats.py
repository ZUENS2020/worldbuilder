"""Import/export format parsing & serialization (pure, no DB/graph access).

Two concerns:

1. **World Book** — import accepts either WorldBuilder's own export or a
   SillyTavern lorebook (world-info JSON, character_book, or a full V2 card with
   an embedded ``character_book``). Everything is normalized to WorldEntry field
   dicts. Export emits the native shape.

2. **Project graph bundle** — a self-contained JSON of entities + relations +
   world entries for moving a whole world between projects/machines. Import
   always creates a NEW project (id remapping is done by the router).

These helpers never touch the DB; callers feed in / persist ORM rows.
"""

from typing import Any

WORLDBOOK_TYPE = "worldbuilder.worldbook"
PROJECT_TYPE = "worldbuilder.project"
FORMAT_VERSION = 1


# ── World Book ───────────────────────────────────────────────────

def _as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v) for v in value if str(v).strip()]
    return []


def _normalize_native_entry(e: dict) -> dict:
    scope = e.get("scope") or "global"
    if scope not in ("global", "entity"):
        scope = "global"
    enabled = e.get("enabled", 1)
    return {
        "title": str(e.get("title") or ""),
        "content": str(e.get("content") or ""),
        "scope": scope,
        "entity_ids": _as_str_list(e.get("entity_ids")),
        "keys": _as_str_list(e.get("keys")),
        "priority": int(e.get("priority") or 0),
        "enabled": 0 if enabled in (0, False) else 1,
        "properties": e.get("properties") if isinstance(e.get("properties"), dict) else {},
    }


def _normalize_st_entry(e: dict) -> dict:
    """Map one SillyTavern lorebook entry → WorldEntry fields.

    ST entries are keyword-triggered; we have no keyword RAG, so every entry is
    imported as a ``global`` always-on entry (keys preserved for reference).
    Disabled entries keep ``enabled=0``. Non-constant entries are flagged in
    ``properties._st_triggered`` so the user can tell which were keyword-gated.
    """
    title = e.get("comment") or e.get("name") or ""
    keys = _as_str_list(e.get("keys") or e.get("key"))
    if not title and keys:
        title = keys[0]
    disabled = bool(e.get("disable")) or e.get("enabled") is False
    priority = e.get("order")
    if priority is None:
        priority = e.get("insertion_order")
    props: dict = {}
    if e.get("constant") is False:
        props["_st_triggered"] = True
    if keys:
        props.setdefault("_st_keys", keys)
    return {
        "title": str(title or ""),
        "content": str(e.get("content") or ""),
        "scope": "global",
        "entity_ids": [],
        "keys": keys,
        "priority": int(priority or 0),
        "enabled": 0 if disabled else 1,
        "properties": props,
    }


def parse_world_entries(data: Any) -> list[dict]:
    """Auto-detect format and return a list of normalized WorldEntry field dicts.

    Accepts: native export ``{type:'worldbuilder.worldbook', entries:[...]}`` or a
    bare native list; ST world-info ``{entries:{...}}``; character_book
    ``{entries:[...]}``; or a V2 card ``{data:{character_book:{entries:[...]}}}``.
    """
    # Unwrap a full V2 character card.
    if isinstance(data, dict) and isinstance(data.get("data"), dict) and \
            isinstance(data["data"].get("character_book"), dict):
        data = data["data"]["character_book"]
    if isinstance(data, dict) and isinstance(data.get("character_book"), dict):
        data = data["character_book"]

    # Native WorldBuilder export.
    if isinstance(data, dict) and data.get("type") == WORLDBOOK_TYPE:
        return [_normalize_native_entry(e) for e in (data.get("entries") or []) if isinstance(e, dict)]

    # Bare native list (heuristic: entries carry our own field names).
    if isinstance(data, list):
        out = []
        for e in data:
            if not isinstance(e, dict):
                continue
            if "scope" in e or "title" in e:
                out.append(_normalize_native_entry(e))
            else:
                out.append(_normalize_st_entry(e))
        return out

    # ST-shaped: {entries: dict | list}
    if isinstance(data, dict) and "entries" in data:
        entries = data["entries"]
        if isinstance(entries, dict):
            entries = list(entries.values())
        if isinstance(entries, list):
            out = []
            for e in entries:
                if not isinstance(e, dict):
                    continue
                # Native entries inside {entries:[...]} (our own export uses 'type').
                if "scope" in e or ("title" in e and "comment" not in e and "key" not in e):
                    out.append(_normalize_native_entry(e))
                else:
                    out.append(_normalize_st_entry(e))
            return out

    raise ValueError("Unrecognized World Book format")


def serialize_world_entries(entries: list) -> dict:
    """Native World Book export envelope from WorldEntry ORM rows."""
    return {
        "type": WORLDBOOK_TYPE,
        "version": FORMAT_VERSION,
        "entries": [
            {
                "title": w.title,
                "content": w.content,
                "scope": w.scope,
                "entity_ids": list(w.entity_ids or []),
                "keys": list(w.keys or []),
                "priority": w.priority,
                "enabled": w.enabled,
                "properties": w.properties or {},
            }
            for w in entries
        ],
    }


# ── Character card (TavernAI / SillyTavern) ──────────────────────

# ST-specific card fields that aren't graph properties but are preserved so the
# st-plugin can still drive immersive roleplay (greeting, examples, prompts).
_ST_CARD_FIELDS = (
    "first_mes", "mes_example", "system_prompt", "post_history_instructions",
    "creator_notes", "alternate_greetings", "creator", "character_version",
)


def parse_character_card(data: Any) -> dict:
    """Parse a TavernAI/SillyTavern character card into entity fields.

    Accepts a V1 flat card (``{name, description, personality, scenario, ...}``)
    or a V2/V3 card (``{spec, data:{...}}``). Recognized narrative fields map to
    graph property keys the engine knows (``description``/``personality``/
    ``scenario``); the remaining ST-only fields are stashed under
    ``properties._st_card`` so they stay out of context injection but remain
    available as the roleplay output. An embedded ``character_book`` is returned
    separately for the caller to import as entity-scoped World Book entries.

    Returns ``{name, type:'character', properties, character_book}``.
    """
    if not isinstance(data, dict):
        raise ValueError("角色卡格式无法识别")
    core = data.get("data") if isinstance(data.get("data"), dict) else data

    name = str(core.get("name") or core.get("char_name") or "").strip()
    if not name:
        raise ValueError("角色卡缺少 name 字段")

    props: dict = {}
    for src, dst in (("description", "description"), ("personality", "personality"),
                     ("scenario", "scenario")):
        val = str(core.get(src) or "").strip()
        if val:
            props[dst] = val

    st_card: dict = {}
    for k in _ST_CARD_FIELDS:
        v = core.get(k)
        if v not in (None, "", [], {}):
            st_card[k] = v
    spec = data.get("spec") or core.get("spec")
    if spec:
        st_card["spec"] = str(spec)
    tags = _as_str_list(core.get("tags"))
    if tags:
        st_card["tags"] = tags
    if st_card:
        props["_st_card"] = st_card

    character_book = core.get("character_book")
    if not isinstance(character_book, dict):
        character_book = None

    return {"name": name, "type": "character", "properties": props,
            "character_book": character_book}


# ── Project graph bundle ─────────────────────────────────────────

def serialize_project_bundle(project, entities: list, relations: list, world_entries: list) -> dict:
    """Self-contained graph export: entities + relations + world entries."""
    return {
        "type": PROJECT_TYPE,
        "version": FORMAT_VERSION,
        "name": project.name,
        "description": project.description or "",
        "settings": project.settings or {},
        "entities": [
            {"id": e.id, "name": e.name, "type": e.type, "properties": e.properties or {}}
            for e in entities
        ],
        "relations": [
            {
                "source_id": r.source_id, "target_id": r.target_id, "type": r.type,
                "properties": r.properties or {}, "weight": r.weight,
            }
            for r in relations
        ],
        "world_entries": serialize_world_entries(world_entries)["entries"],
    }


def parse_project_bundle(data: Any) -> dict:
    """Validate a project bundle and return normalized lists.

    Returns ``{name, description, settings, entities, relations, world_entries}``
    with entity ids preserved as-is (the router remaps them to fresh ids).
    """
    if not isinstance(data, dict) or data.get("type") != PROJECT_TYPE:
        raise ValueError("Not a WorldBuilder project bundle")
    entities = []
    for e in data.get("entities") or []:
        if not isinstance(e, dict) or not e.get("id") or not e.get("name"):
            continue
        entities.append({
            "id": str(e["id"]),
            "name": str(e["name"]),
            "type": str(e.get("type") or "character"),
            "properties": e.get("properties") if isinstance(e.get("properties"), dict) else {},
        })
    relations = []
    for r in data.get("relations") or []:
        if not isinstance(r, dict) or not r.get("source_id") or not r.get("target_id"):
            continue
        relations.append({
            "source_id": str(r["source_id"]),
            "target_id": str(r["target_id"]),
            "type": str(r.get("type") or "custom"),
            "properties": r.get("properties") if isinstance(r.get("properties"), dict) else {},
            "weight": float(r.get("weight") if r.get("weight") is not None else 0.5),
        })
    world_entries = [
        _normalize_native_entry(w) for w in (data.get("world_entries") or []) if isinstance(w, dict)
    ]
    return {
        "name": str(data.get("name") or "导入的项目"),
        "description": str(data.get("description") or ""),
        "settings": data.get("settings") if isinstance(data.get("settings"), dict) else {},
        "entities": entities,
        "relations": relations,
        "world_entries": world_entries,
    }
