# WorldBuilder 🌐

> 构建世界观就像在做一次情报调查——你是自己世界的首席分析师。
>
> *A knowledge-graph worldbuilding platform that treats your story bible like an OSINT investigation.*

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Backend](https://img.shields.io/badge/backend-FastAPI-009688)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61dafb)

WorldBuilder 是一个以**知识图谱为核心**的世界观构建与调查平台。借鉴 OSINT 情报工具（[Maltego](https://www.maltego.com/)）的交互范式，把人物、地点、事件、阵营组织成一张可视化关系图，解决复杂设定中的两大痛点：

- **人物关系混乱** —— 几十个角色、上百条关系，写到后面自己都记不清谁和谁是什么关系。
- **AI 生成 OOC（崩人设）** —— 传统 Lorebook 靠关键词全量注入，token 浪费且「串词」，AI 写着写着就把人物写歪了。

WorldBuilder 用**图距离驱动的精准上下文注入**取代关键词匹配：只把与当前出场角色 N-hop 内相关的设定喂给 AI（跳数可在设置中按场景分别配置），token 高效，且能主动预警设定矛盾。

此外，内置 **Agent 关系演化模拟器**（战争迷雾、信念层、戏剧增强）与 **SillyTavern 插件**（上下文注入 + 对话回写），把图谱、模拟记忆与角色扮演对话打通。

---

## 目录

- [核心能力](#-核心能力)
- [快速开始](#-快速开始)
- [导入世界观数据](#-导入世界观数据)
- [导入 / 导出](#-导入--导出)
- [SillyTavern 插件](#-sillytavern-插件)
- [联调测试](#-st--wb-联调测试)
- [Cursor Skills](#-cursor-skills)
- [技术栈](#-技术栈)
- [API 端点](#-api-端点节选)
- [项目结构](#-项目结构)
- [许可证](#-许可证)

---

## ✨ 核心能力

### 知识图谱与画布

| 能力 | 说明 |
|------|------|
| **Maltego 风格 Transform** | 右键节点 → 环形展开关联；人物/地点/事件各有专属操作（关系人、参与事件、敌对阵营、AI 推断等） |
| **探索模式** | 从任意节点「只看此子图」；Transform 逐步揭示关联，支持撤销（⌘Z）与重置起点 |
| **画布交互** | 框选 / 套索多选、拖拽撤销重做（⌘Z / ⌘⇧Z）、节点隔离与隐藏 |
| **可配置图跳数** | 五类查询深度（1–5 跳）独立配置：Transform、敌对阵营、AI 上下文、ST 注入、探索子图 |
| **事件图 & 时间轴** | 因果图（`caused` / `followed_by` + ELK 布局）；时间轴按 `properties.time` 排列并跳转高亮 |

### AI 辅助（OpenRouter，模型可配置）

- **推断关联** —— 分析角色间可能存在但尚未记录的关系
- **检测矛盾** —— 敌友矛盾、性格冲突、时间线冲突
- **生成背景** —— 根据图谱生成自洽的人物背景
- **建议复核** —— 所有 AI 产出先进复核面板，逐条接受 / 拒绝后才落库

### 图距离 Context 注入（对比传统 Lorebook）

| | 传统 ST Lorebook | WorldBuilder |
|---|---|---|
| 触发 | 关键词匹配 | N-hop 图查询（可配置） |
| 注入量 | O(N) 全量 | 精准、按图距离 |
| 结果 | Token 浪费 + 串词 | Token 高效 + 防 OOC |
| 矛盾 | 无感知 | 主动矛盾预警 |

### Agent 关系演化模拟器

模拟器以 **tick** 为单位推进世界：调度相遇 → Actor 行动 → Oracle 裁决 → 关系/状态突变 → 情景记忆 → 快照回放。

| 能力 | 说明 |
|------|------|
| **单步 / 自动演化** | 手动单步推进，或开启后台循环按间隔自动 tick（SSE 实时推送） |
| **回放与重置** | Tick 时间轴拖拽回看历史；一键重置到模拟创建时的初始状态 |
| **战争迷雾** | 实体级 / 属性级可见性；画布「以…视角」预览 |
| **信念层** | 每角色维护主观世界副本；**信念 / 真相** 面板对照过时认知与 canonical 真相 |
| **世界书** | 图锚定硬检索（`global` 常驻 + `entity` 挂载），按在场实体注入 |
| **启发扰动（Nudge）** | 随机 / 指定 / 按人脉向角色注入模糊预感，打破僵局 |
| **事件结晶** | Oracle 将重要转折凝结为事件节点，互动流中以芯片展示 |
| **ST 回写** | SillyTavern 对话先入队，在 **「ST 回写」** 标签审阅后手动 / 每 N 轮 / 自动 LLM 落库 |

#### 戏剧增强系统

四套可独立开关的机制，由统一强度档位（0–1）缩放，避免模拟陷入 endless 寒暄：

| 机制 | 开关 | 作用 |
|------|------|------|
| **演员** | `drama_actor` | 鼓励决定性行动与冲突，而非客套寒暄 |
| **裁决** | `drama_oracle` | 放开关系变化幅度，允许决裂 / 翻脸一步到位 |
| **调度** | `drama_scheduler` | 主动撮合敌对 / 陌生角色制造对抗 |
| **事件注入** | `drama_event_injector` | 周期性注入外部突发事件（危机、介入、抉择等） |
| **张力累积** | `drama_tension` | 敌对关系见面无实质变化则积压张力，临界强制爆发 |
| **导演** | `drama_director` | 全局导演周期性升级一条冲突弧线 |

### SillyTavern 桥接

- **角色卡导入** —— 从 Palette 导入 TavernAI / SillyTavern 角色卡（`.json` 或嵌入 PNG），自动创建人物实体；内嵌 `character_book` 转为实体挂载世界书
- **ST 插件 v0.6** —— 图谱 / 可见性 / 信念上下文注入、模拟记忆块、对话回写队列

---

## 🚀 快速开始

### 1. 后端

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# 编辑 .env，填入 OpenRouter API Key

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

后端启动在 http://localhost:8000（SQLite 数据库自动创建）。

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

### 3. 配置 AI

在应用内「设置」填入 OpenRouter Key 与模型（支持每项目独立配置），或在 `backend/.env` 设置全局默认值。

### 4. Docker 部署（生产）

```bash
cp .env.example .env   # 填入 OPENROUTER_API_KEY
docker compose build
docker compose up -d
```

访问 http://localhost:8090 —— nginx 托管前端并反代 `/api` 到后端；SQLite 数据持久化在 `./data/`。

---

## 📦 导入世界观数据

`scripts/` 提供从 Python 数据模块批量写入图谱的通用导入器：

```bash
# 确保后端已启动
cd scripts
python3 import_world.py sanguo_data
```

数据模块需导出 `PROJECT`、`ENTITIES`、`RELATIONS` 三个常量。仓库内置**三国演义**示例（137 实体、177 关系）：

| 文件 | 说明 |
|------|------|
| `scripts/sanguo_data.py` | 演义原著人物、阵营、战役与关系 |
| `scripts/seed_sanguo.py` | 薄封装，等价于 `import_world.py sanguo_data` |

Docker 环境指定 API 地址：

```bash
WORLDBUILDER_API=http://localhost:8090/api python3 import_world.py sanguo_data
```

同名项目已存在时会先删除再重建。新建世界观：复制 `sanguo_data.py` 改写成 `myworld_data.py` 后导入即可。

**模拟器最小测试图谱**（3 人 + 茶馆 + 失窃案，含 private 秘密属性）：

```bash
cd scripts
python3 seed_sim_test.py
```

| 文件 | 说明 |
|------|------|
| `scripts/sim_test_data.py` | 林远 / 小夏 / 阿明 等最小场景 |
| `scripts/seed_sim_test.py` | 薄封装导入器 |

---

## 📥 导入 / 导出

除脚本批量导入外，应用内支持 JSON 格式的世界书与整项目图谱交换：

| 类型 | 范围 | 入口 |
|------|------|------|
| **世界书** | 词条（lore），追加到当前项目 | 世界书面板 `⬆ 导入` / `⬇ 导出` |
| **图谱** | 实体 + 关系 + 世界书，新建项目 | 项目切换器每行 `⬇` 导出、底部 `⬆ 导入图谱` |
| **角色卡** | 单个人物实体 + 内嵌世界书 | Palette `导入角色卡`（`.json` / `.png`） |

世界书导入自动识别 SillyTavern Lorebook / World Info / V2 角色卡内嵌词条。详见 [`docs/import-export.md`](docs/import-export.md)。

---

## 🔌 SillyTavern 插件

插件位于 `st-plugin/`（**v0.6.0**），兼容 **SillyTavern 1.18+** 扩展 API。

### 安装

```bash
cp -r st-plugin "<SillyTavern>/data/<your-user>/extensions/worldbuilder-context"
```

或在 SillyTavern「扩展 → 安装扩展」里通过 Git URL 安装。

### 配置项

| 设置 | 说明 |
|------|------|
| **Context mode** | `visibility`（默认，角色卡视角迷雾）· `truth`（全知）· `belief`（信念副本，可过时） |
| **Project / Simulation** | 选择 WB 项目与模拟；记忆注入与回写需绑定 Simulation |
| **Inject memory** | 注入该角色在模拟器中的情景记忆块 |
| **Queue writeback** | 每轮对话结束后入队，在 WB **「ST 回写」** 审阅 |
| **Inject at** | `before_char` / `after_char` / `before_system` / `before_scenario` / `macro_only` |

> **角色卡名必须与图谱实体 `name` 完全一致**（如「林远」），否则插件会提示未绑定。

### 使用流程

1. 启动 WorldBuilder 后端（默认 `http://localhost:8000`）。
2. 在 SillyTavern「扩展」面板展开 **🌐 WorldBuilder**，选择项目并设置 Context mode。
3. 可选：绑定 Simulation，开启记忆注入或回写入队。
4. 正常对话 —— 插件在 `CHAT_COMPLETION_PROMPT_READY` 注入上下文；回写在 WB 模拟器审阅。

> ⚠️ 若 SillyTavern 与 WB 后端都占用 8000，请把 ST 的 `config.yaml` 改为 `port: 8100`（或其它端口）。

### 工作原理

```
CHAT_COMPLETION_PROMPT_READY
  → 提取角色卡名 + @提及
  → GET /entities/context 或 /beliefs/context (?observer=角色卡名)
  → 可选 GET /simulations/{id}/memory-block
  → 注入 system 消息

GENERATION_END（可选）
  → POST /simulations/{id}/st-writeback/queue
  → WB「ST 回写」面板：预览 / 执行 / 丢弃
```

回写触发模式（在 WB 模拟器配置，存于 `Simulation.config`）：

| 模式 | 行为 |
|------|------|
| `manual` | 仅入队，用户勾选后执行 |
| `every_n_rounds` | 满 N 条 pending 自动 apply |
| `auto_llm` | 每条入队后立即 Oracle 回写并 tick+1 |

详见 [`st-plugin/TESTING.md`](st-plugin/TESTING.md)、[`st-plugin/CHANGELOG.md`](st-plugin/CHANGELOG.md)。

---

## 🧪 ST + WB 联调测试

```bash
# 终端 1：WB 后端
cd backend && uvicorn app.main:app --reload

# 终端 2
cd scripts
python3 seed_sim_test.py
python3 st_plugin_integration_test.py
```

为 SillyTavern 生成与图谱同名的角色卡 PNG（林远、小夏、阿明）：

```bash
node scripts/create_st_characters.mjs [SillyTavern根目录]
# 默认写入 <ST>/data/default-user/characters/
```

在 ST 中选对应角色卡，扩展里绑定「模拟器测试」项目即可联调。完整手测清单见 [`st-plugin/TESTING.md`](st-plugin/TESTING.md)。

---

## 🎯 Cursor Skills

`skills/` 存放**供用户手动挂载**的 Cursor Agent Skills（与 `.cursor/` IDE 配置无关）。

在 Cursor 对话中 `@` → **Attach Skill** → 选择 `skills/worldbuilder-import/SKILL.md`，即可让 AI 按规范调研原著资料、编写数据文件并导入图谱。详见 [skills/README.md](skills/README.md)。

---

## 🧱 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite |
| 图谱可视化 | [@xyflow/react](https://reactflow.dev/) + ELKjs 自动布局 |
| 状态管理 | Zustand |
| Markdown | react-markdown + remark-gfm |
| 后端 | Python 3.13 + FastAPI + Uvicorn |
| 数据/图存储 | SQLite + SQLAlchemy（async）+ 内存邻接表图引擎 |
| AI | OpenRouter（OpenAI 兼容，模型可配置） |
| 模拟器 | Actor / Oracle 双阶段 LLM + SSE 流式推送 |
| ST 插件 | SillyTavern 1.18 Extension API |

---

## 📡 API 端点（节选）

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/projects` | 创建项目 |
| `POST` | `/api/projects/import` | 从 bundle 新建项目 |
| `GET`  | `/api/projects/{id}/entities` | 列出实体 |
| `POST` | `/api/projects/{id}/entities/import-card` | 导入 ST 角色卡为人物实体 |
| `GET`  | `/api/projects/{id}/entities/context` | ST 图谱上下文（可见性过滤） |
| `POST` | `/api/projects/{id}/beliefs/seed` | 幂等播种信念行 |
| `GET`  | `/api/projects/{id}/beliefs/context` | ST 信念上下文 |
| `POST` | `/api/projects/{id}/simulations` | 创建模拟 |
| `POST` | `/api/projects/{id}/simulations/{sid}/step` | 单步推进 tick |
| `POST` | `/api/projects/{id}/simulations/{sid}/play` | 启动后台自动演化 |
| `POST` | `/api/projects/{id}/simulations/{sid}/pause` | 暂停后台演化 |
| `POST` | `/api/projects/{id}/simulations/{sid}/reset` | 重置到初始快照 |
| `GET`  | `/api/projects/{id}/simulations/{sid}/stream` | SSE 实时 tick 流 |
| `GET`  | `/api/projects/{id}/simulations/{sid}/memory-block` | 格式化记忆块（ST 注入） |
| `POST` | `/api/projects/{id}/simulations/{sid}/st-writeback/queue` | ST 对话入队 |
| `GET`  | `/api/projects/{id}/entities/{eid}/neighbors` | N-hop 邻居查询 |
| `POST` | `/api/projects/{id}/transforms/execute` | 执行 Transform |

完整接口见 FastAPI 自动文档：http://localhost:8000/docs

---

## 📂 项目结构

```
world_builder/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── models/           # Entity, Relation, Simulation, Belief, StWritebackQueue…
│   │   ├── routers/          # projects, entities, relations, transforms,
│   │   │                     #   simulations, world_entries, beliefs
│   │   ├── services/         # ai_service, simulation, belief, memory, drama, st_writeback
│   │   └── graph/            # 内存图引擎、visibility、worldbook
│   └── requirements.txt
├── frontend/
│   └── src/components/
│       ├── Simulator/        # InteractionFeed, BeliefPanel, WritebackPanel, TickTimeline
│       ├── Canvas/, Inspector/, WorldBook/, EventGraph/, Timeline/, …
│       └── …
├── st-plugin/                # SillyTavern 插件 v0.6
├── scripts/                  # 数据导入、联调测试、ST 角色卡生成
├── docs/import-export.md
├── skills/
└── docker-compose.yml
```

---

## 📄 许可证

本项目基于 [GNU Affero General Public License v3.0](LICENSE) 开源。

你可以自由使用、修改和分发本项目；若你通过网络提供本软件的交互服务，须向用户提供对应源码。任何基于本项目的衍生作品在分发时也必须以 AGPL-3.0 开源并提供源码。
