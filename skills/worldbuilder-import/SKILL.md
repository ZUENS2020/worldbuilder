---
name: worldbuilder-import
description: Research fictional or historical worldbuilding sources and import structured knowledge graphs into WorldBuilder projects via seed scripts and API. Use when the user wants to调研世界观、导入图谱、批量建实体关系、seed project、三国演义式数据包、或同步到 Docker 服务器。
---

# WorldBuilder 世界观调研与导入

将外部资料（原著、设定集、维基等）整理为 WorldBuilder 知识图谱，并通过 API 写入项目。

> 本文件位于仓库 `skills/worldbuilder-import/`，请在 Cursor 对话中 **@ 附加此 Skill** 后再下达任务。

## 快速流程

```
任务进度：
- [ ] 1. 确认资料边界（原著 / 改编 / 混合）
- [ ] 2. 调研并列出实体清单
- [ ] 3. 编写 scripts/<slug>_data.py
- [ ] 4. 运行 scripts/import_world.py <slug>_data
- [ ] 5. 本地导入并验证
- [ ] 6. （可选）同步到服务器
```

## Step 1：确认资料边界

向用户确认（未说明时默认按**原著/正史主文本**）：

| 问题 | 示例 |
|------|------|
| 以哪部作品为准？ | 《三国演义》原著，不含游戏/影视魔改 |
| 语言与命名？ | 中文通行译名，properties 用中文 |
| 覆盖深度？ | 主线全员 + 重大战役，或仅核心角色 |

**禁止**在无依据时编造关系；有争议处写入 `properties.note` 标注来源或演义章节。

## Step 2：调研输出结构

调研后按五类实体组织（与前端 `EntityType` 一致）：

| type | 用途 | 典型 properties |
|------|------|-----------------|
| `character` | 人物 | `courtesy_name`, `alias`, `personality`, `goal`, `background`, `occupation`, `weapon`, `death` |
| `faction` | 阵营/势力 | `description`, `era` |
| `location` | 地点 | `description`, `region` |
| `event` | 事件/战役 | `time`, `description` |
| `item` | 器物/坐骑 | `description`, `owner` |

关系使用内置 `RelationType`（见 [reference.md](reference.md)）。

## Step 3：编写数据文件

在 `scripts/<slug>_data.py` 中定义 `PROJECT`、`ENTITIES`、`RELATIONS`。参考：`scripts/sanguo_data.py`。

## Step 4：导入

```bash
cd scripts
python3 import_world.py <slug>_data
```

环境变量 `WORLDBUILDER_API` 覆盖 API 地址（默认 `http://localhost:8000/api`）。同名项目会先删除再重建。

## Step 5：本地验证

后端：`cd backend && uvicorn app.main:app --reload --port 8000`

导入后打开前端 → 切换项目 →「整理」排布图谱。应看到 `0 skipped` relations。

## Step 6：同步到服务器

```bash
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude '.env' --exclude 'data' \
  ./ nec:~/worldbuilder/

ssh nec "cd ~/worldbuilder/scripts && \
  WORLDBUILDER_API=http://localhost:8090/api python3 import_world.py <slug>_data"
```

## 附加资源

- [reference.md](reference.md) — API 与类型
- [examples.md](examples.md) — 三国演义示例
