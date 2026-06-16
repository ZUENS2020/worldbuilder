# WorldBuilder

> 写小说就像在做一次情报调查——你是自己世界的首席分析师。

一个以**知识图谱为核心**的 AI 辅助小说创作平台，借鉴 OSINT 工具（Maltego）的交互设计，解决长篇小说中人物关系混乱、AI 生成 OOC 崩人设的核心痛点。

## 快速开始

### 后端

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

### SillyTavern 插件

将 `st-plugin/` 目录添加为 SillyTavern 扩展，在设置中配置 WorldBuilder API URL。

## 核心特性

### 🔮 Maltego 风格 Transform 系统
右键节点 → 展开关联 → 新节点环形出现。支持按实体类型过滤操作：
- **人物**：展开关系人 / 展开参与事件 / AI推断潜在关联 / 查找敌对阵营
- **地点**：展开在此的人物 / 展开发生的事件
- **事件**：展开参与人物 / 展开关联事件

### 🤖 AI 深度集成（DeepSeek V4 Flash via OpenRouter）
- **AI 推断关联**：分析角色可能存在但尚未记录的关系
- **AI 检测矛盾**：检测设定中的逻辑冲突（敌友矛盾、性格矛盾）
- **AI 生成背景**：根据已有信息生成自洽的背景故事

### 🌐 图距离驱动的 Context 注入
- 传统 ST Lorebook：关键词匹配 → O(N) 全量注入 → Token 浪费 + 串词
- WorldBuilder：2-hop 图查询 → 精准注入 → Token 高效 + 防OOC

### ⏳ 时间轴视图
事件实体按 `properties.time` 排列，点击可跳转图谱高亮。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + ReactFlow |
| 图谱可视化 | ReactFlow + ELKjs 自动布局 |
| 后端 | Python + FastAPI |
| 图存储 | SQLite + 内存邻接表（后期可迁移 Neo4j） |
| AI | OpenRouter DeepSeek V4 Flash |
| ST 插件 | 标准 SillyTavern Extension API |

## API 端点

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/{id}/entities` | 列出实体 |
| POST | `/api/projects/{id}/entities` | 创建实体 |
| GET | `/api/projects/{id}/relations` | 列出关系 |
| POST | `/api/projects/{id}/relations` | 创建关系 |
| GET | `/api/projects/{id}/entities/{id}/neighbors?hop=2` | N-hop 邻居查询 |
| GET | `/api/projects/{id}/entities/context?characters=李长安` | ST 插件上下文注入 |
| GET | `/api/projects/{id}/transforms/{entity_type}` | 获取可用 Transform |
| POST | `/api/projects/{id}/transforms/execute` | 执行 Transform |

## 项目结构

```
world_builder/
├── backend/               # Python FastAPI
│   ├── app/
│   │   ├── main.py        # 入口
│   │   ├── database.py    # SQLite + SQLAlchemy
│   │   ├── models/        # 数据模型
│   │   ├── routers/       # API 路由
│   │   ├── services/      # AI 服务
│   │   └── graph/         # 内存图引擎
│   └── requirements.txt
├── frontend/              # React + TS + Vite
│   ├── src/
│   │   ├── components/    # Canvas, Palette, Inspector, ContextMenu, Timeline
│   │   ├── stores/        # Zustand 状态管理
│   │   ├── services/      # API 调用
│   │   ├── types/         # TypeScript 类型
│   │   └── utils/         # 布局算法
│   └── package.json
├── st-plugin/             # SillyTavern 插件
│   ├── manifest.json
│   └── index.js
└── README.md
```
