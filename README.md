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

此外，内置 **Agent 关系演化模拟器**（因果推演、战争迷雾、信念层）与 **SillyTavern 插件**（上下文注入 + 对话回写），把图谱、模拟记忆与角色扮演对话打通。

---

## 目录

- [核心能力](#-核心能力)
- [快速开始](#-快速开始)
- [导入世界观数据](#-导入世界观数据)
- [模拟器：推演机制](#-模拟器推演机制)
- [导入 / 导出](#-导入--导出)
- [SillyTavern 插件](#-sillytavern-插件)
- [联调与回归测试](#-联调与回归测试)
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

模拟器以 **tick** 为单位推进世界，定位是**因果推演引擎**，而非剧情导演：

```
调度相遇 → Actor（角色主观行动）→ Oracle（世界裁决）
  → 关系/状态/事件突变 → 信念同步 → 情景记忆 → SimTick 快照
```

| 能力 | 说明 |
|------|------|
| **单步 / 自动演化** | 手动单步推进，或开启后台循环按间隔自动 tick（SSE 实时推送） |
| **回放与重置** | Tick 时间轴拖拽回看历史；一键重置到模拟创建时的初始状态 |
| **战争迷雾** | 实体级 / 属性级可见性；画布「以…视角」预览 |
| **信念层** | 每角色维护主观世界副本；**信念 / 真相** 面板对照过时认知与 canonical 真相 |
| **世界书** | 图锚定硬检索（`global` 常驻 + `entity` 挂载），按在场实体注入 |
| **启发扰动（Nudge）** | 随机 / 指定 / 按人脉向角色注入模糊预感，打破僵局 |
| **悬决事件 & 推演结算** | 预设或自主登记的 `pending` 事件，因果成熟后 `resolve` 落下不可逆后果；结算时标注各参与者目标 `achieved`/`defeated`/`ongoing`，赢家目标落为「已了结」不再重复开战 |
| **事件结晶** | Oracle 将重要转折凝结为事件节点，互动流中以芯片展示；语义去重折叠近义重复 |
| **稳态落幕** | 以「进展度」（而非「有没有动」）判定世界是否入均衡；连续 `stability_window` 个无进展 tick 自动暂停并提示「🎬 本幕落幕」，可继续推进注入新变量 |
| **ST 回写** | SillyTavern 对话先入队，在 **「ST 回写」** 标签审阅后手动 / 每 N 轮 / 自动 LLM 落库 |

#### 设计原则

- **LLM = 角色决策 + 世界裁决**，不是编剧；prompt 强调因果合理性，而非戏剧张力
- **预设锚点仅作冷启动**；`sequence_order` 约束导入时的引导事件顺序，之后由角色目标驱动自主登记新悬决
- **不写结局，但会落幕** —— 不设三幕结构或剧本化结局；但当世界达到新均衡（连续若干 tick 无实质进展）时**自动暂停并提示「本幕落幕」**，而非靠制造冲突无限续命。「导演不决定发生什么，世界状态决定」——真实世界也会停在新的平衡上
- **Actor 信息不对称** —— 每场相遇只从发起方信念副本叙事，对手信念事后机械同步

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

> 若提示 `Address already in use`，说明已有实例在跑：`lsof -ti:8000 | xargs kill` 后再启动。

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

数据模块需导出 `PROJECT`、`ENTITIES`、`RELATIONS` 三个常量。

### 内置示例

| 文件 | 说明 |
|------|------|
| `scripts/sanguo_data.py` | 三国演义（137 实体、177 关系） |
| `scripts/seed_sanguo.py` | 薄封装，等价于 `import_world.py sanguo_data` |
| `scripts/sim_test_data.py` | 模拟器最小测试（3 人 + 茶馆 + 失窃案） |
| `scripts/seed_sim_test.py` | 薄封装导入最小测试图谱 |
| `scripts/manor_mystery_data.py` | **雾港·黎氏庄园** — 8 角色悬疑封闭局，含 3 个预设悬决锚点 |
| `scripts/evolution_test_data.py` | 演进测试图谱（验证自主事件登记与目标驱动） |
| `scripts/seed_evolution_test.py` | 薄封装导入演进测试 |

```bash
# 悬疑封闭局（推荐用于跑模拟器）
python3 import_world.py manor_mystery_data

# 演进机制测试
python3 import_world.py evolution_test_data
```

Docker 环境指定 API 地址：

```bash
WORLDBUILDER_API=http://localhost:8090/api python3 import_world.py manor_mystery_data
```

同名项目已存在时会先删除再重建。新建世界观：复制 `sanguo_data.py` 改写成 `myworld_data.py` 后导入即可。

数据模块可为事件节点附加推演元数据：

```python
{
    "name": "真遗嘱浮现",
    "type": "event",
    "properties": {
        "status": "pending",
        "stakes": "继承格局彻底反转…",
        "due_tick": 10,
        "sequence_order": 2,  # 仅约束预设引导锚点的结算顺序
    },
}
```

---

## 🎲 模拟器：推演机制

### 一次 tick 的流程

1. **Nudge**（可选）—— 向选定角色注入模糊预感
2. **Scheduler** —— 按人脉权重 / 随机 / 冲突撮合挑选相遇对
3. **Actor** —— 每场相遇由发起方信念上下文生成叙事与意图
4. **Oracle** —— 整 tick 裁决：关系突变、事件结晶、悬决登记、`ripe_events` 信号
5. **推演结算** —— 因果成熟的 `pending` 事件调用 `ai_resolve_event` 落下后果
6. **信念同步** —— 参与者互相更新主观副本
7. **记忆写入** —— 情景记忆追加，超阈值时压缩
8. **SimTick 快照** —— 完整 interactions / mutations / metrics 落库

### 悬决事件生命周期

| 阶段 | 说明 |
|------|------|
| `pending` | 登记时写入 `stakes`、`due_tick`（可选）、`sequence_order`（预设锚点） |
| Oracle `ripe` | LLM 判断因果成熟；`due_tick` 前 ripe 信号无效 |
| `resolve` | 结算后 `status=resolved`，写入 `outcome`，产生不可逆突变；并标注各参与者 `goal_status`（`achieved`/`defeated` 的目标落为「已了结」，仅 `ongoing` 重派新目标） |
| 自主登记 | 角色目标冲突扫描 / 悬决空窗补种 / intent 兜底，无需人工预埋；均需**真实前向张力**（关系权重达档 + 目标未了结）才触发，世界静下来时允许 pending 队列保持空 |

### 关键配置项（`Simulation.config`）

| 键 | 默认 | 说明 |
|----|------|------|
| `max_encounters_per_tick` | 4 | 每 tick 最多几场相遇 |
| `scheduler_mix_conflict` | false | 额外撮合一对敌对/陌生角色 |
| `generate_events` | true | Oracle 是否结晶事件节点 |
| `event_min_significance` | 0.6 | 场景结晶为事件节点的显著度阈值（越高越克制） |
| `pending_max_age` | 8 | 悬决超时强制结算（0=关闭） |
| `nudge_strategy` | off | 扰动策略：off / random / targeted / weighted |
| `tick_interval_sec` | 6 | 自动演化间隔（秒） |
| `max_ticks` | 0 | 自动暂停上限（0=不限） |
| `stability_window` | 4 | 连续无**进展** tick 后自动落幕暂停（`reason=quiescent`，0=关闭） |

### 推荐工作流（雾港·黎氏庄园）

```bash
cd scripts && python3 import_world.py manor_mystery_data
```

1. 前端打开 **雾港·黎氏庄园** 项目
2. 模拟器 → **＋ 新建模拟**（hybrid 模式）
3. **单步 ⏭** 逐步观察，或 **▶ 自动演化** 后台推进（SSE 实时更新互动流）
4. 在 **信念 / 真相** 面板切换观察者，对照主观认知与 canonical 真相
5. 事件图 / 时间轴查看因果链 `followed_by` 如何生长

预设三个锚点（`sequence_order` 1→2→3）应在因果链上依次结算：**遗嘱宣读 → 真遗嘱浮现 → 死因鉴定结论**。之后世界由角色目标驱动继续演化；当各方目标尘埃落定、连续数 tick 无实质进展时，模拟器会**自动暂停并在互动流顶部显示「🎬 本幕落幕」**——此时可手动继续推进（注入新变量）或重置重跑。

> 推演引擎的完整机制（推演结算、进展度判定、落幕、目标可达成、防枯竭节流阀）见 [`docs/simulation-engine.md`](docs/simulation-engine.md)。

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

## 🧪 联调与回归测试

### ST + WB 联调

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

### 推演引擎回归（无需 LLM）

```bash
cd scripts
python3 deduction_regression_test.py    # 悬决成熟 / sequence_order / 自主登记逻辑
python3 sim_engine_regression_test.py # 模拟器核心路径
```

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
| 模拟器 | Actor / Oracle 双阶段 LLM + 因果推演 + SSE 流式推送 |
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
| `POST` | `/api/projects/{id}/simulations/{sid}/step` | 单步推进 tick（运行中返回 409） |
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
│   │   ├── services/         # ai_service, simulation, belief, memory,
│   │   │                     #   sim_runner, st_writeback
│   │   └── graph/            # 内存图引擎、visibility、worldbook
│   └── requirements.txt
├── frontend/
│   └── src/components/
│       ├── Simulator/        # InteractionFeed, BeliefPanel, WritebackPanel, TickTimeline
│       ├── Canvas/, Inspector/, WorldBook/, EventGraph/, Timeline/, …
│       └── …
├── st-plugin/                # SillyTavern 插件 v0.6
├── scripts/                  # 数据导入、示例图谱、联调与回归测试
├── docs/                     # import-export.md, simulation-engine.md
├── skills/
└── docker-compose.yml
```

---

## 📄 许可证

本项目基于 [GNU Affero General Public License v3.0](LICENSE) 开源。

你可以自由使用、修改和分发本项目；若你通过网络提供本软件的交互服务，须向用户提供对应源码。任何基于本项目的衍生作品在分发时也必须以 AGPL-3.0 开源并提供源码。
