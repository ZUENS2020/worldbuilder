# WorldBuilder 🌐

> 构建世界观就像在做一次情报调查——你是自己世界的首席分析师。
>
> *A knowledge-graph-driven worldbuilding platform that treats your story bible like an OSINT investigation.*

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Backend](https://img.shields.io/badge/backend-FastAPI-009688)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61dafb)

一个以**知识图谱为核心**的世界观构建与调查平台。借鉴 OSINT 情报工具（[Maltego](https://www.maltego.com/)）的交互范式，把人物、地点、事件、阵营组织成一张可视化关系图，解决复杂设定中的两大痛点：

- **人物关系混乱** —— 几十个角色、上百条关系，写到后面自己都记不清谁和谁是什么关系。
- **AI 生成 OOC（崩人设）** —— 传统 Lorebook 靠关键词全量注入，token 浪费且"串词"，AI 写着写着就把人物写歪了。

WorldBuilder 用**图距离驱动的精准上下文注入**取代关键词匹配：只把与当前出场角色 N-hop 内相关的设定喂给 AI（跳数可在设置中按场景分别配置），token 高效，且能主动预警设定矛盾。

此外，内置 **Agent 关系演化模拟器**：角色按 tick 相遇、行动、改变世界，并支持**战争迷雾**与**每角色一份信念副本**（信念 vs 真相），与 SillyTavern 插件打通后可做上下文注入与对话回写。

---

## ✨ 核心特性

### 🧭 探索模式
从任意节点「只看此子图」进入探索模式：画布只显示已揭示的实体，Transform 展开会逐步点亮关联节点。支持探索历史撤销（⌘Z）、重置到起点，适合从核心角色出发逐层摸清世界观。

### 🖱️ 画布交互
- **框选 / 套索** —— 矩形或自由路径多选节点，同步到 Inspector 与 Palette
- **撤销 / 重做** —— 节点拖拽与自动布局的位置变更支持 ⌘Z / ⌘⇧Z
- **隔离 / 隐藏** —— 右键菜单可单独隐藏节点，或进入探索子图

### ⚙️ 可配置图跳数
每个项目可在「设置」中独立配置五类图查询深度（1–5 跳）：
Transform 展开、敌对阵营搜索、AI 上下文、ST 上下文注入、探索子图隔离。

### 🔮 Maltego 风格 Transform 系统
右键任意节点 → 展开关联 → 相关节点以环形动画展开。按实体类型提供不同操作：
- **人物**：展开关系人 / 展开参与事件 / AI 推断潜在关联 / 查找敌对阵营
- **地点**：展开在此的人物 / 展开发生的事件
- **事件**：展开参与人物 / 展开关联事件

### 🤖 AI 深度集成（OpenRouter，模型可配置）
- **AI 推断关联** —— 分析角色之间可能存在但尚未记录的关系
- **AI 检测矛盾** —— 找出设定中的逻辑冲突（敌友矛盾、性格矛盾、时间线冲突）
- **AI 生成背景** —— 根据已有图谱信息生成自洽的人物背景故事
- **AI 建议复核** —— 所有 AI 产出先进入复核面板，逐条接受 / 拒绝后才落库

### 🌐 图距离驱动的 Context 注入（对比传统 Lorebook）
| | 传统 ST Lorebook | WorldBuilder |
|---|---|---|
| 触发 | 关键词匹配 | N-hop 图查询（可配置） |
| 注入量 | O(N) 全量 | 精准、按图距离 |
| 结果 | Token 浪费 + 串词 | Token 高效 + 防 OOC |
| 矛盾 | 无感知 | 主动矛盾预警 |

### ⏳ 事件图 & 时间轴
- **事件因果图**：以 `caused` / `followed_by` 关系绘制因果脉络，ELK 层级布局
- **时间轴视图**：事件按 `properties.time` 排列，点击跳转主图谱并高亮

### 🎭 Agent 关系演化模拟器
- **单步 tick**：调度相遇 → Actor 行动 → Oracle 裁决 → 关系/状态突变 → 情景记忆 → 快照回放
- **战争迷雾**：实体级 / 属性级可见性（Inspector 配置；画布「以…视角」预览）
- **信念层**：每个角色维护主观世界副本；**信念 / 真相** 面板对照过时认知与 canonical 真相
- **世界书**：图锚定硬检索（`global` 常驻 + `entity` 挂载），按在场实体注入
- **ST 回写**：SillyTavern 对话先入队，在模拟器 **「ST 回写」** 标签审阅后手动 / 每 N 轮 / 自动 LLM 落库

### 🔌 SillyTavern 插件（v0.6）
把 WorldBuilder 的图谱上下文、信念视图、模拟记忆与对话回写桥接到 SillyTavern。详见 [SillyTavern 插件](#-sillytavern-插件) 与 [联调测试](#-st--wb-联调测试)。

---

## 🚀 快速开始

### 1. 后端

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 OpenRouter API Key

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

后端启动在 http://localhost:8000 （SQLite 数据库会自动创建）。

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

### 3. 配置 AI

在应用内的「设置」对话框中填入 OpenRouter Key 与模型（支持每个项目独立配置），或在 `backend/.env` 中设置全局默认值。

### 4. Docker 部署（生产）

```bash
cp .env.example .env   # 填入 OPENROUTER_API_KEY
docker compose build
docker compose up -d
```

访问 http://localhost:8090 —— nginx 托管前端并反代 `/api` 到后端；SQLite 数据持久化在 `./data/`。

---

## 📦 导入世界观数据

`scripts/` 提供从 Python 数据模块批量写入图谱的通用导入器，无需手写 API 调用。

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
python3 seed_sim_test.py    # 导入「模拟器测试」项目
```

| 文件 | 说明 |
|------|------|
| `scripts/sim_test_data.py` | 林远 / 小夏 / 阿明 等最小场景 |
| `scripts/seed_sim_test.py` | 薄封装导入器 |

---

## 🎯 Cursor Skills（用户技能）

`skills/` 存放**供用户手动挂载**的 Cursor Agent Skills（与 `.cursor/` IDE 配置无关）。

在 Cursor 对话中 `@` → **Attach Skill** → 选择 `skills/worldbuilder-import/SKILL.md`，即可让 AI 按规范调研原著资料、编写数据文件并导入图谱。详见 [skills/README.md](skills/README.md)。

---

## 🔌 SillyTavern 插件

插件位于 `st-plugin/`（当前 **v0.6.0**），兼容 **SillyTavern 1.18+** 扩展 API。

### 安装

把插件目录拷贝到 SillyTavern 用户数据下的扩展目录：

```bash
cp -r st-plugin "<SillyTavern>/data/<your-user>/extensions/worldbuilder-context"
```

或在 SillyTavern 的「扩展 → 安装扩展」里通过 Git URL 安装。

### 配置项

| 设置 | 说明 |
|------|------|
| **Context mode** | `visibility`（默认，当前角色卡视角迷雾）· `truth`（全知作者视角）· `belief`（信念副本，可过时） |
| **Project / Simulation** | 下拉选择 WB 项目与模拟；记忆注入与回写需绑定 Simulation |
| **Inject memory** | 注入该角色在模拟器中的情景记忆块 |
| **Queue writeback** | 每轮对话结束后入队，在 WB **「ST 回写」** 审阅 |
| **Inject at** | `before_char` / `after_char` / `before_system` / `before_scenario` / `macro_only` |

> **角色卡名必须与图谱实体 `name` 完全一致**（如「林远」），否则插件会提示未绑定。

### 使用

1. 启动 WorldBuilder 后端（默认 `http://localhost:8000`）。
2. 在 SillyTavern「扩展」面板展开 **🌐 WorldBuilder**，选择项目并设置 Context mode。
3. 可选：绑定 Simulation，开启记忆注入或回写入队。
4. 正常对话——插件在 `CHAT_COMPLETION_PROMPT_READY` 注入上下文；回写在 WB 模拟器审阅。

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

一键导入测试图谱并跑 API 集成检查（可见性 / 信念 / 回写队列）：

```bash
# 终端 1：WB 后端
cd backend && uvicorn app.main:app --reload

# 终端 2
cd scripts
python3 seed_sim_test.py
python3 st_plugin_integration_test.py
```

为 SillyTavern 生成与图谱同名的角色卡 PNG（角色名：林远、小夏、阿明）：

```bash
node scripts/create_st_characters.mjs [SillyTavern根目录]
# 默认写入 <ST>/data/default-user/characters/
```

然后在 ST 中选对应角色卡，扩展里绑定「模拟器测试」项目即可联调。完整手测清单见 [`st-plugin/TESTING.md`](st-plugin/TESTING.md)。

---

## 🧱 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite |
| 图谱可视化 | [@xyflow/react](https://reactflow.dev/) + ELKjs 自动布局 |
| 状态管理 | Zustand |
| Markdown | react-markdown + remark-gfm（统一 `normalizeMarkdown`） |
| 后端 | Python 3.13 + FastAPI + Uvicorn |
| 数据/图存储 | SQLite + SQLAlchemy（async）+ 内存邻接表图引擎 |
| AI | OpenRouter（OpenAI 兼容，模型可配置） |
| ST 插件 | 标准 SillyTavern 1.18 Extension API |

---

## 📡 API 端点（节选）

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/projects` | 创建项目 |
| `GET`  | `/api/projects/{id}/entities` | 列出实体 |
| `GET`  | `/api/projects/{id}/entities/context?characters=&observer=` | ST 图谱上下文（可见性过滤） |
| `POST` | `/api/projects/{id}/beliefs/seed` | 幂等播种信念行 |
| `GET`  | `/api/projects/{id}/beliefs/context?observer=&characters=` | ST 信念上下文 |
| `POST` | `/api/projects/{id}/simulations` | 创建模拟 |
| `POST` | `/api/projects/{id}/simulations/{sid}/step` | 单步推进 tick |
| `GET`  | `/api/projects/{id}/simulations/{sid}/memory-block?entity=` | 格式化记忆块（ST 注入） |
| `POST` | `/api/projects/{id}/simulations/{sid}/st-writeback/queue` | ST 对话入队 |
| `GET`  | `/api/projects/{id}/simulations/{sid}/st-writeback` | 待回写列表 |
| `POST` | `/api/projects/{id}/simulations/{sid}/st-writeback/apply` | 执行回写 |
| `GET`  | `/api/projects/{id}/entities/{eid}/neighbors?hop=2` | N-hop 邻居查询 |
| `POST` | `/api/projects/{id}/transforms/execute` | 执行 Transform |

完整接口见 FastAPI 自动文档：后端启动后访问 http://localhost:8000/docs 。世界书 / 图谱导入导出见 [`docs/import-export.md`](docs/import-export.md)。

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
│   │   ├── services/         # ai_service, simulation, belief, memory, st_writeback
│   │   └── graph/            # 内存图引擎、visibility、worldbook
│   └── requirements.txt
├── frontend/
│   └── src/components/
│       ├── Simulator/        # InteractionFeed, BeliefPanel, WritebackPanel
│       ├── Canvas/, Inspector/, WorldBook/, …
│       └── …
├── st-plugin/                # SillyTavern 插件 v0.6
│   ├── index.js
│   ├── CHANGELOG.md
│   └── TESTING.md
├── scripts/
│   ├── import_world.py
│   ├── sim_test_data.py      # 模拟器测试图谱
│   ├── seed_sim_test.py
│   ├── create_st_characters.mjs
│   └── st_plugin_integration_test.py
├── docs/import-export.md
├── skills/
└── docker-compose.yml
```

---

## 📄 许可证

本项目基于 [GNU Affero General Public License v3.0](LICENSE) 开源。

你可以自由使用、修改和分发本项目；若你通过网络提供本软件的交互服务，须向用户提供对应源码。任何基于本项目的衍生作品在分发时也必须以 AGPL-3.0 开源并提供源码。
