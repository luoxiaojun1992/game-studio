# Game Dev Studio - WorkBuddy Instructions (Index Only)

> 按仓库约定，公共 instruction 已抽取到：
> `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md`（仓库根目录相对路径）

## WorkBuddy 入口指引（必要信息）

1. 优先阅读公共文档：
   - [AI_AGENT_COMMON_INSTRUCTIONS.md](../.agent/AI_AGENT_COMMON_INSTRUCTIONS.md)
2. WorkBuddy 经验与历史记录索引：
   - [INDEX.md](../.agent/memory/INDEX.md)
   - 产物提交双模式（HTML/ZIP）、游戏查询工具（`get_games`/`get_game_info`）、Blender 建模链路（`blender_*` + creator service）与存储链路可查看 [ARCHITECTURE.md](../.agent/memory/ARCHITECTURE.md) 与 [LINT.md](../.agent/memory/LINT.md)
3. 仅在需要 WorkBuddy 专属上下文时，再进入 `../.agent/memory/` 下细分文档。
4. 工具 schema 已移除 `project_id` 入参；项目作用域由后端在工具服务初始化时注入，编写 mock/tool_calls 时需与当前 schema 保持一致（不要再显式传该字段）。
5. 数据库结构变更采用 DDL 优先策略：先更新 `server/db.ts` 的 `CREATE TABLE` 定义；迁移仅用于历史数据补齐。
6. Star-Office 同步已切换为多项目持续同步模型；`/api/projects/switch` 不再触发 Agent offline/online 同步切换。
7. 数据模型更新：`games` 已移除 `author_agent_id`；`agent_messages`/`logs`/`commands`/`permission_requests` 统一包含 `updated_at`。

## 目标

- 避免在 `.workbuddy` 与其他目录重复维护同一套规范内容
- 以 `.agent` 文档作为唯一真源（SSOT）
