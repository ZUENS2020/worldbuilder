# 导入 / 导出 (Import & Export)

WorldBuilder 支持两类导入导出：

| 类型 | 范围 | 导入目标 | 入口 |
| --- | --- | --- | --- |
| **世界书 World Book** | 词条（lore） | **当前项目（追加）** | 世界书面板右上角 `⬆ 导入` / `⬇ 导出` |
| **图谱 Graph** | 整个项目（实体 + 关系 + 世界书） | **仅新建项目** | 项目切换器：每行 `⬇` 导出、底部 `⬆ 导入图谱（新建项目）` |

两者都是纯 JSON 文件，浏览器直接下载 / 选择本地文件上传。后端解析逻辑集中在
[`backend/app/services/io_formats.py`](../backend/app/services/io_formats.py)。

---

## 一、世界书 World Book

### 导出

下载当前项目的全部词条，格式为 WorldBuilder 原生信封：

```json
{
  "type": "worldbuilder.worldbook",
  "version": 1,
  "entries": [
    {
      "title": "学园都市设定",
      "content": "**特雷森学园** 是……（markdown）",
      "scope": "global",
      "entity_ids": [],
      "keys": ["特雷森", "学园"],
      "priority": 100,
      "enabled": 1,
      "properties": {}
    }
  ]
}
```

字段说明：

- `scope` — `global`（全局常驻，恒注入）或 `entity`（挂载实体，仅当挂载的实体在场时注入）。
- `entity_ids` — 仅 `scope=="entity"` 有意义；任一在场即触发。
- `keys` — 关键词，**仅作兼容保留**。本项目用图锚定硬检索，不做关键词 RAG，`keys` 不影响注入。
- `priority` — 数值越大越先注入；超出 token 预算时低优先级被截断。
- `enabled` — `1` 启用 / `0` 停用。

### 导入（追加到当前项目）

`⬆ 导入` 会把所选文件里的词条**追加**到当前项目（不覆盖已有词条），并自动识别格式。

支持的格式：

1. **WorldBuilder 原生**（上面的 `worldbook` 信封，或裸词条数组）。
2. **SillyTavern 世界书 / Lorebook**，含以下三种形态，均自动识别：
   - World Info 导出：`{ "entries": { "0": {...}, "1": {...} } }`（对象）
   - Character Book：`{ "entries": [ {...}, ... ] }`（数组）
   - V2 角色卡：`{ "data": { "character_book": { "entries": [...] } } }`

#### SillyTavern → WorldBuilder 字段映射

| ST 字段 | WorldBuilder | 说明 |
| --- | --- | --- |
| `comment` / `name` | `title` | 都没有时取第一个 key |
| `content` | `content` | 原样 |
| `key` / `keys` | `keys` | 保留备查，不参与触发 |
| `order` / `insertion_order` | `priority` | |
| `disable` / `enabled` | `enabled` | `disable:true` 或 `enabled:false` → 停用 |
| `constant:false` | `properties._st_triggered = true` | 标记原为「关键词触发」词条 |

> ⚠️ **重要差异**：SillyTavern 的词条是关键词触发的，而 WorldBuilder **没有关键词 RAG**。
> 因此所有 ST 词条都会被导入为 **`global` 全局常驻**。原本靠关键词才触发的词条
> （`constant:false`）会被打上 `properties._st_triggered` 标记，方便你导入后手动改成
> `entity` 作用域、挂到相关实体上，或调低 `priority`，避免全部恒注入撑爆上下文。

---

## 二、图谱 Graph（整项目）

### 导出

项目切换器里每个项目行的 `⬇` 图标导出该项目的完整图谱：

```json
{
  "type": "worldbuilder.project",
  "version": 1,
  "name": "ウマ娘 Pretty Derby",
  "description": "……",
  "settings": { },
  "entities": [
    { "id": "<uuid>", "name": "无声铃鹿", "type": "character", "properties": { } }
  ],
  "relations": [
    { "source_id": "<uuid>", "target_id": "<uuid>", "type": "rival",
      "properties": { }, "weight": 0.8 }
  ],
  "world_entries": [ /* 同上世界书词条，去掉信封 */ ]
}
```

### 导入（仅新建项目）

项目切换器底部 `⬆ 导入图谱（新建项目）`：

- 图谱导入**永远新建一个项目**，不会合并进当前项目（避免 id 冲突与数据污染）。
- 导入时实体 id 会**重新映射为新 uuid**，`relations`、`world_entries.entity_ids`、
  `properties` / `settings` 里的实体引用（可见度白名单、tag、faction 成员等）会同步重写，
  保证副本自洽。同一份文件可重复导入，互不影响。
- 端点缺失的关系（两端实体不在 bundle 中）会被丢弃。
- 导入完成后自动切换到新项目，并载入内存图引擎。

---

## API 参考

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/projects/{pid}/world-entries/export` | 导出世界书 |
| `POST` | `/api/projects/{pid}/world-entries/import` | 导入世界书到该项目（追加），body = 任意支持的 JSON |
| `GET` | `/api/projects/{pid}/export` | 导出整项目图谱 bundle |
| `POST` | `/api/projects/import` | 从 bundle 新建项目，body = bundle JSON |

前端封装见 [`frontend/src/services/api.ts`](../frontend/src/services/api.ts)
（`exportWorldEntries` / `importWorldEntries` / `exportProject` / `importProject`），
文件下载/选择工具见 [`frontend/src/utils/fileIo.ts`](../frontend/src/utils/fileIo.ts)。
