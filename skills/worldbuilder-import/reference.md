# WorldBuilder 导入参考

## API 端点

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/projects` | 列表 / 创建项目 |
| DELETE | `/api/projects/{id}` | 删除项目（级联实体与关系） |
| POST | `/api/projects/{id}/entities` | 创建实体 |
| POST | `/api/projects/{id}/relations` | 创建关系 |

## 实体类型

`character` | `location` | `event` | `item` | `faction`

## 关系类型

`ally` `enemy` `rival` `lover` `family` `mentor` `subordinate` `member_of` `located_at` `participated` `caused` `followed_by` `holds` `owns`

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `WORLDBUILDER_API` | `http://localhost:8000/api` | 导入脚本 API 根路径 |

| 环境 | API |
|------|-----|
| 本地开发 | `http://localhost:8000/api` |
| Docker 服务器 | `http://localhost:8090/api` |
