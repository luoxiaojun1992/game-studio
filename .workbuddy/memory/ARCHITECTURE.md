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
- `src/components/ProposalList.tsx` - 提案列表组件
- `src/components/GameList.tsx` - 游戏成品列表组件
- `src/pages/StudioPage.tsx` - 主页面（Tab 导航、项目管理、权限横幅、提案表单）

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

## E2E 测试架构
- **测试框架**: Playwright + TypeScript
- **Mock 服务**: `tests/mock-server/codebuddy-sdk-mock-server.mjs`（per-agent 路由队列）
- **Docker 编排**: `docker-compose.ui-test.yml`（5 个服务）
- **测试入口**: `tests/ui/e2e/studio.spec.ts`（9 个用例）
- **核心模式**: `runFullWorkflowTest()` — 目标状态驱动的事件循环，UI-007/008 共用
- **数据流**: 测试 → Mock Admin API (port 3001) → 预设响应队列 → Agent 调用 /chat/completions → 匹配 (projectId, agentRole) → 返回预设响应

### Docker 服务依赖图
```
codebuddy-sdk-mock (:3001)     ← Mock Server
       ↓ (health check)
star-office-ui (:19000)        ← Star Office 前端
       ↓ (health check)
studio-backend (:3000)         ← Express API + SSE
       ↓ (health check)
ui-app (:4173)                 ← 前端静态文件 (nginx)
       ↓ (health check)
ui-e2e                         ← Playwright CI 执行
```

### 前端组件 data-testid 架构
- 所有可交互元素统一使用 `data-testid` 属性
- 动态 ID 格式：`handoff-card-${id}`、`proposal-item-${id}`、`game-card-${id}`、`tab-${key}`
- 状态属性：`data-handoff-status`、`data-agent-to`、`data-agent-from`、`data-game-name`
- 详见 E2E_TESTING.md 完整对照表
