# WorldBuilder Skills

本目录存放**给用户手动挂载**的 Cursor Agent Skills，与 `.cursor/` 下的 IDE 配置无关。

## 如何使用

1. 在 Cursor 对话里输入 **`@`**，选择 **Attach Skill**（或 **Add skill**）
2. 浏览到本仓库的 `skills/<skill-name>/SKILL.md` 并附加
3. 或在对话开头写：`请按 skills/worldbuilder-import/SKILL.md 执行`

也可将某个 skill 目录复制到 `~/.cursor/skills/`，即可在所有项目里全局使用。

## 可用 Skills

| Skill | 说明 |
|-------|------|
| [worldbuilder-import](worldbuilder-import/SKILL.md) | 调研原著/设定资料，编写数据文件并导入 WorldBuilder 图谱（含本地与服务器） |

## 贡献新 Skill

在 `skills/` 下新建文件夹，至少包含 `SKILL.md`（带 YAML frontmatter 的 `name` 与 `description`）。可选：`reference.md`、`examples.md`、配套脚本放在仓库 `scripts/`。
