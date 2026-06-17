# WorldBuilder 🌐

> 构建世界观就像在做一次情报调查——你是自己世界的首席分析师。
>
> *A knowledge-graph-driven worldbuilding platform that treats your story bible like an OSINT investigation.*

![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Backend](https://img.shields.io/badge/backend-FastAPI-009688)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61dafb)

一个以**知识图谱为核心**的世界观构建与调查平台。借鉴 OSINT 情报工具（[Maltego](https://www.maltego.com/)）的交互范式，把人物、地点、事件、阵营组织成一张可视化关系图，解决复杂设定中的两大痛点：

- **人物关系混乱** —— 几十个角色、上百条关系，写到后面自己都记不清谁和谁是什么关系。
- **AI 生成 OOC（崩人设）** —— 传统 Lorebook 靠关键词全量注入，token 浪费且"串词"，AI 写着写着就把人物写歪了。

WorldBuilder 用**图距离驱动的精准上下文注入**取代关键词匹配：只把与当前出场角色 N-hop 内相关的设定喂给 AI（跳数可在设置中按场景分别配置），token 高效，且能主动预警设定矛盾。

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

### 🔌 SillyTavern 插件
把 WorldBuilder 的图谱上下文实时注入到 SillyTavern 的对话 Prompt 中，让任意角色扮演都能自动获得防 OOC 的设定支持。详见 [SillyTavern 插件](#-sillytavern-插件) 一节。

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

---

## 🎯 Cursor Skills（用户技能）

`skills/` 存放**供用户手动挂载**的 Cursor Agent Skills（与 `.cursor/` IDE 配置无关）。

在 Cursor 对话中 `@` → **Attach Skill** → 选择 `skills/worldbuilder-import/SKILL.md`，即可让 AI 按规范调研原著资料、编写数据文件并导入图谱。详见 [skills/README.md](skills/README.md)。

---

## 🔌 SillyTavern 插件

插件位于 `st-plugin/`，兼容 **SillyTavern 1.18+** 扩展 API。

### 安装

把插件目录拷贝到 SillyTavern 的第三方扩展目录（注意 SillyTavern 会自动加上 `third-party/` 前缀，**不要**自己再套一层）：

```bash
cp -r st-plugin "<SillyTavern>/data/<your-user>/extensions/worldbuilder-context"
```

或在 SillyTavern 的「扩展 → 安装扩展」里通过 Git URL 安装。

### 使用

1. 启动 WorldBuilder 后端（默认 `http://localhost:8000`）。
2. 在 SillyTavern「扩展」面板展开 **🌐 WorldBuilder**，确认 API URL，可选填项目 ID（留空则自动检测第一个项目）。
3. 正常对话即可——插件会在 `CHAT_COMPLETION_PROMPT_READY` 事件上拦截 Prompt，提取出场角色（当前角色卡名 + 消息中的 `@提及`），查询图谱上下文并注入（跳数取自项目 `context_injection` 设置，插件可通过 `?hop=` 覆盖）。

> ⚠️ 若 SillyTavern 默认端口（8000）与 WorldBuilder 后端冲突，请修改其中一个的端口（例如把 SillyTavern 的 `config.yaml` 改成 `port: 8100`）。

### 工作原理

```
对话 Prompt 就绪 → 提取出场角色 → GET /api/projects/{id}/entities/context?characters=...
→ 后端按图距离构建 system_injection + 矛盾预警 → 作为 system 消息注入 chat 数组
```

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
| `POST` | `/api/projects/{id}/entities` | 创建实体 |
| `GET`  | `/api/projects/{id}/relations` | 列出关系 |
| `POST` | `/api/projects/{id}/relations` | 创建关系 |
| `GET`  | `/api/projects/{id}/entities/{eid}/neighbors?hop=2` | N-hop 邻居查询 |
| `GET`  | `/api/projects/{id}/entities/context?characters=...` | ST 插件上下文注入 |
| `GET`  | `/api/projects/{id}/transforms/{entity_type}` | 获取可用 Transform |
| `POST` | `/api/projects/{id}/transforms/execute` | 执行 Transform |

完整接口见 FastAPI 自动文档：后端启动后访问 http://localhost:8000/docs 。

---

## 📂 项目结构

```
worldbuilder/
├── backend/                  # Python FastAPI
│   ├── app/
│   │   ├── main.py           # 入口
│   │   ├── database.py       # SQLite + 异步 SQLAlchemy
│   │   ├── schemas.py        # Pydantic 模型
│   │   ├── models/           # ORM 数据模型
│   │   ├── routers/          # projects / entities / relations / transforms
│   │   ├── services/         # AI 服务（OpenRouter）
│   │   └── graph/            # 内存图引擎（N-hop、上下文构建）
│   ├── requirements.txt
│   └── .env.example
├── frontend/                 # React + TS + Vite
│   └── src/
│       ├── components/       # Canvas, EventGraph, Inspector, Palette,
│       │                     #   Timeline, AIReview, Settings, Toolbar, common
│       ├── stores/           # Zustand 状态管理
│       ├── services/         # API 调用
│       ├── hooks/            # useCanvasHistory、useTextHistory 等
│       ├── types/            # TypeScript 类型 + 关系配置
│       └── utils/            # ELK 布局算法
├── st-plugin/                # SillyTavern 插件
│   ├── manifest.json
│   └── index.js
├── scripts/                  # 世界观数据导入
│   ├── import_world.py       # 通用导入器
│   ├── sanguo_data.py        # 三国演义示例数据
│   └── seed_sanguo.py
├── skills/                   # 用户可挂载的 Cursor Skills
│   └── worldbuilder-import/
├── docker-compose.yml        # 生产部署（端口 8090）
└── README.md
```

---

## 📄 许可证

本项目基于 [GNU General Public License v3.0](LICENSE) 开源。

你可以自由使用、修改和分发本项目；任何基于本项目的衍生作品在分发时也必须以 GPL-3.0 开源并提供源码。
