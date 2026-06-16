# WorldBuilder 🌐

> 写小说就像在做一次情报调查——你是自己世界的首席分析师。
>
> *A knowledge-graph-driven AI writing platform that treats your story bible like an OSINT investigation.*

![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Backend](https://img.shields.io/badge/backend-FastAPI-009688)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20Vite-61dafb)
![AI](https://img.shields.io/badge/AI-OpenRouter-orange)

一个以**知识图谱为核心**的 AI 辅助长篇小说创作平台。借鉴 OSINT 情报工具（[Maltego](https://www.maltego.com/)）的交互范式，把人物、地点、事件、阵营组织成一张可视化关系图，从根源上解决长篇创作中的两大痛点：

- **人物关系混乱** —— 几十个角色、上百条关系，写到后面自己都记不清谁和谁是什么关系。
- **AI 生成 OOC（崩人设）** —— 传统 Lorebook 靠关键词全量注入，token 浪费且"串词"，AI 写着写着就把人物写歪了。

WorldBuilder 用**图距离驱动的精准上下文注入**取代关键词匹配：只把与当前出场角色 2-hop 内相关的设定喂给 AI，token 高效，且能主动预警设定矛盾。

---

## ✨ 核心特性

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

### ✍️ 文本生成工作台
- 选定出场实体 → 流式生成场景 / 大纲，自动注入对应图谱上下文
- 统一的 Markdown 渲染（标题、列表、引用、表格、代码块），单换行即分段
- 内置撤销 / 重做（⌘Z / ⌘⇧Z），流式生成不污染历史栈
- 可放大的全屏编辑弹窗，编辑 / 预览 / 分栏三种模式

### 🌐 图距离驱动的 Context 注入（对比传统 Lorebook）
| | 传统 ST Lorebook | WorldBuilder |
|---|---|---|
| 触发 | 关键词匹配 | 2-hop 图查询 |
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
3. 正常对话即可——插件会在 `CHAT_COMPLETION_PROMPT_READY` 事件上拦截 Prompt，提取出场角色（当前角色卡名 + 消息中的 `@提及`），查询图谱 2-hop 上下文并注入。

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
| AI | OpenRouter（OpenAI 兼容，模型可配置，SSE 流式） |
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
| `POST` | `/api/projects/{id}/generate/stream` | 流式生成场景 / 大纲（SSE） |

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
│   │   ├── routers/          # projects / entities / relations / transforms / documents
│   │   ├── services/         # AI 服务（OpenRouter，流式）
│   │   └── graph/            # 内存图引擎（N-hop、上下文构建）
│   ├── requirements.txt
│   └── .env.example
├── frontend/                 # React + TS + Vite
│   └── src/
│       ├── components/       # Canvas, EventGraph, Inspector, Palette,
│       │                     #   Timeline, Writing, AIReview, Settings,
│       │                     #   ProjectSwitcher, ContextMenu, Toolbar, common
│       ├── stores/           # Zustand 状态管理
│       ├── services/         # API 调用 + SSE
│       ├── hooks/            # useTextHistory（撤销/重做）等
│       ├── types/            # TypeScript 类型 + 关系配置
│       └── utils/            # ELK 布局算法
├── st-plugin/                # SillyTavern 插件
│   ├── manifest.json
│   └── index.js
└── README.md
```

---

## 📄 许可证

本项目基于 [GNU General Public License v3.0](LICENSE) 开源。

你可以自由使用、修改和分发本项目；任何基于本项目的衍生作品在分发时也必须以 GPL-3.0 开源并提供源码。
