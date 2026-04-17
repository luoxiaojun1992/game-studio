# 项目架构

## 项目概述
- 游戏开发 Agent 团队观测控制台
- 技术栈: Express + SQLite + React + TypeScript + Tailwind + TDesign
- 端口: 后端 3000, 前端 5173

## 架构关键点
- `server/db.ts` - SQLite 所有数据操作
- `server/tools.ts` - SDK Custom Tools（MCP 自定义工具）
- `server/agent-manager.ts` - Agent 管理器，通过 mcpServers 注册自定义工具
- `server/agents.ts` - Agent 定义 + 系统提示词（TOOLS_OVERVIEW）
- `server/sse-broadcaster.ts` - SSE 广播（解耦循环依赖）
- `server/index.ts` - Express 路由
- `src/components/CommandPanel.tsx` - 指令面板（含历史记录）
- `src/components/HandoffPanel.tsx` - 交接面板（含确认流程）

## SDK Custom Tools 架构
- 使用 `@tencent-ai/agent-sdk` 的 `createSdkMcpServer` + `tool` 注册自定义工具
- 工具通过 `mcpServers` 参数传给 `query()`，Agent 像内置工具一样直接调用
- 不再需要 curl hack（之前通过 Bash+curl 调 localhost API）
- 记忆通过 `getMemorySummaryForPrompt()` 注入 systemPrompt
- zod 依赖用于定义工具的参数 schema
- 6 个内置工具: `save_memory`, `get_memories`, `create_handoff`, `submit_proposal`, `submit_game`, `get_proposals`, `get_pending_handoffs`
- project_id 全部内部使用 scopedProjectId，不依赖外部参数输入

## Agent 角色
- 6 个 Agent: `game_designer`, `architect`, `engineer`, `biz_designer`, `ceo`, `team_builder`
- `team_builder` 每个 agent 结束后运行，负责总结沉淀记忆，handoffTargets 为空数组

## canUseTool 放行规则
- `mcp__studio-tools__*` 工具自动放行（无需权限检查）
