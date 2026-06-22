# Import & Export

[简体中文](import-export.md) · **English**

WorldBuilder supports two kinds of import/export:

| Type | Scope | Import target | Entry point |
| --- | --- | --- | --- |
| **World Book** | Entries (lore) | **Current project (append)** | `⬆ Import` / `⬇ Export` at the top-right of the world-book panel |
| **Graph** | The whole project (entities + relations + world book) | **New project only** | Project switcher: per-row `⬇` export, `⬆ Import graph (new project)` at the bottom |

Both are plain JSON files, downloaded directly by the browser / uploaded by choosing a local file. The backend parsing logic is centralized in [`backend/app/services/io_formats.py`](../backend/app/services/io_formats.py).

---

## 1. World Book

### Export

Downloads all entries of the current project, in WorldBuilder's native envelope:

```json
{
  "type": "worldbuilder.worldbook",
  "version": 1,
  "entries": [
    {
      "title": "Academy City setting",
      "content": "**Tracen Academy** is……（markdown）",
      "scope": "global",
      "entity_ids": [],
      "keys": ["Tracen", "academy"],
      "priority": 100,
      "enabled": 1,
      "properties": {}
    }
  ]
}
```

Field notes:

- `scope` — `global` (always-on, always injected) or `entity` (mounted to entities, injected only when a mounted entity is present).
- `entity_ids` — meaningful only for `scope=="entity"`; any one present triggers it.
- `keys` — keywords, **kept for compatibility only**. This project uses graph-anchored hard retrieval, not keyword RAG, so `keys` does not affect injection.
- `priority` — higher values are injected first; lower-priority ones are truncated when the token budget is exceeded.
- `enabled` — `1` enabled / `0` disabled.

### Import (append to the current project)

`⬆ Import` **appends** the entries in the selected file to the current project (it does not overwrite existing entries) and auto-detects the format.

Supported formats:

1. **WorldBuilder native** (the `worldbook` envelope above, or a bare array of entries).
2. **SillyTavern world book / Lorebook**, in the following three shapes, all auto-detected:
   - World Info export: `{ "entries": { "0": {...}, "1": {...} } }` (object)
   - Character Book: `{ "entries": [ {...}, ... ] }` (array)
   - V2 character card: `{ "data": { "character_book": { "entries": [...] } } }`

#### SillyTavern → WorldBuilder field mapping

| ST field | WorldBuilder | Notes |
| --- | --- | --- |
| `comment` / `name` | `title` | If neither exists, take the first key |
| `content` | `content` | As-is |
| `key` / `keys` | `keys` | Kept for reference, not used for triggering |
| `order` / `insertion_order` | `priority` | |
| `disable` / `enabled` | `enabled` | `disable:true` or `enabled:false` → disabled |
| `constant:false` | `properties._st_triggered = true` | Marks an entry that was originally "keyword-triggered" |

> ⚠️ **Important difference**: SillyTavern's entries are keyword-triggered, whereas WorldBuilder **has no keyword RAG**.
> Therefore all ST entries are imported as **`global` always-on**. Entries that originally triggered only on keywords
> (`constant:false`) are tagged with `properties._st_triggered`, so that after import you can manually change them to
> `entity` scope, mount them to relevant entities, or lower their `priority`, to avoid all of them being injected
> constantly and blowing up the context.

---

## 2. Graph (whole project)

### Export

The `⬇` icon on each project row in the project switcher exports that project's complete graph:

```json
{
  "type": "worldbuilder.project",
  "version": 1,
  "name": "Uma Musume Pretty Derby",
  "description": "……",
  "settings": { },
  "entities": [
    { "id": "<uuid>", "name": "Silence Suzuka", "type": "character", "properties": { } }
  ],
  "relations": [
    { "source_id": "<uuid>", "target_id": "<uuid>", "type": "rival",
      "properties": { }, "weight": 0.8 }
  ],
  "world_entries": [ /* same world-book entries as above, without the envelope */ ]
}
```

### Import (new project only)

`⬆ Import graph (new project)` at the bottom of the project switcher:

- A graph import **always creates a new project**; it never merges into the current project (avoiding id collisions and data pollution).
- On import, entity ids are **remapped to new uuids**, and entity references in `relations`, `world_entries.entity_ids`, and `properties` / `settings` (visibility allowlists, tags, faction members, etc.) are rewritten in sync, ensuring the copy is self-consistent. The same file can be imported repeatedly without interference.
- Relations with a missing endpoint (one of the two entities is not in the bundle) are discarded.
- After import it automatically switches to the new project and loads it into the in-memory graph engine.

---

## API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/{pid}/world-entries/export` | Export the world book |
| `POST` | `/api/projects/{pid}/world-entries/import` | Import a world book into the project (append), body = any supported JSON |
| `GET` | `/api/projects/{pid}/export` | Export the whole-project graph bundle |
| `POST` | `/api/projects/import` | Create a new project from a bundle, body = bundle JSON |

The frontend wrapper is in [`frontend/src/services/api.ts`](../frontend/src/services/api.ts)
(`exportWorldEntries` / `importWorldEntries` / `exportProject` / `importProject`),
and the file download/picker utilities are in [`frontend/src/utils/fileIo.ts`](../frontend/src/utils/fileIo.ts).
