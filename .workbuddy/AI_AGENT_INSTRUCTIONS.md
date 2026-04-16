# Game Dev Studio - AI Agent Instructions

> 本文档为后续 AI Agent 迭代本项目提供规范约束和架构指导。

## 项目概述

Game Dev Studio 是一个基于 CodeBuddy Agent SDK 的多 Agent 游戏研发工作台，提供团队协作、提案评审、任务看板、任务交接、游戏产出、运行观测与 Star-Office-UI 联动能力。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express + TypeScript |
| 前端 | React 18 + TypeScript + Vite |
| 数据库 | SQLite (`better-sqlite3`) |
| UI 组件 | TDesign React |
| AI SDK | `@tencent-ai/agent-sdk` |
| 测试 | Playwright (E2E) |

## 架构核心原则

### 1. 项目隔离
- 所有数据按 `project_id` 隔离
- Agent 状态、记忆、日志、任务看板都绑定到具体项目
- 默认项目 ID 为 `'default'`

### 2. Agent 角色定义
```typescript
// server/agents.ts
export const AGENT_IDS = ['engineer', 'architect', 'game_designer', 'biz_designer', 'ceo', 'team_builder'] as const;
```

**交接流程约束**（硬编码在 tools.ts 中）：
- `game_designer` → `ceo`
- `ceo` → `architect` 或 `biz_designer`
- `architect` → `engineer`
- `engineer` → `biz_designer`
- `biz_designer` → `ceo`

### 3. SDK Custom Tools 架构
- 使用 `createSdkMcpServer` + `tool()` 注册自定义工具
- 工具通过 `mcpServers` 参数传给 `query()`
- 工具名前缀为 `mcp__studio_tools__`
- 记忆通过 `getMemorySummaryForPrompt()` 注入 systemPrompt

### 4. 关键文件位置

| 功能 | 文件路径 |
|------|----------|
| Agent 管理器 | `server/agent-manager.ts` |
| Agent 定义 | `server/agents.ts` |
| 自定义工具 | `server/tools.ts` |
| 数据库操作 | `server/db.ts` |
| SSE 广播 | `server/sse-broadcaster.ts` |
| Express 路由 | `server/index.ts` |

## 编码规范

### TypeScript
- 使用 ES Module (`"type": "module"`)
- 后端文件使用 `.ts` 扩展名，运行时通过 `tsx` 编译
- 避免循环依赖（已通过 sse-broadcaster.ts 解耦）

### 数据库
- 使用 `better-sqlite3` 的同步 API
- 所有表都有 `project_id` 字段用于项目隔离
- 关键表：`agents`, `handoffs`, `tasks`, `memories`, `proposals`, `games`, `logs`

### 环境变量
```bash
# 核心变量
CODEBUDDY_BASE_URL=http://localhost:3001  # Mock server 或真实 API
CODEBUDDY_API_KEY=your-api-key
PORT=3000                                  # 后端端口

# 可选变量
STAR_OFFICE_UI_URL=http://127.0.0.1:19000  # Star-Office-UI 地址
```

## 修改约束

### ⚠️ 禁止随意修改的内容

1. **Agent 交接流程** (`ALLOWED_HANDOFF_TARGETS` in `tools.ts`)
   - 这是业务核心逻辑，修改会影响整个工作流
   - 如需修改，需同步更新 `agents.ts` 中的系统提示词

2. **工具定义 Schema** (`server/tools.ts`)
   - 使用 zod 定义的参数 schema
   - 修改会影响 Agent 调用行为

3. **数据库 Schema** (`server/db.ts`)
   - 表结构变更需考虑数据迁移
   - 新增字段需提供默认值

### ✅ 可以安全修改的内容

1. **UI 组件** (`src/components/`)
   - 添加 `data-testid` 属性用于测试
   - 样式调整（Tailwind CSS）

2. **Mock Server** (`tests/mock-server/`)
   - 添加新的 mock 端点
   - 调整响应内容

3. **日志和调试信息**
   - 添加 `console.log` 用于调试
   - 调整日志格式

## 测试规范

### UI E2E 测试
```bash
# 运行测试
npm run test:ui

# 带覆盖率检查
npm run test:ui:coverage

# Docker 环境测试
docker-compose -f docker-compose.ui-test.yml up ui-e2e
```

### Mock Server
- 路径：`/chat/completions` (不是 `/v1/chat/completions`)
- 支持流式 (SSE) 和非流式响应
- 管理端点：`/__admin/mocks`, `/__admin/reset`

## 常见任务指南

### 添加新工具
1. 在 `server/tools.ts` 中使用 `tool()` 定义
2. 添加 zod schema 参数验证
3. 在 `agents.ts` 的 `TOOLS_OVERVIEW` 中描述工具用途
4. 如需自动授权，在 `agent-manager.ts` 的 `CAN_AUTO_ALLOW` 中添加

### 添加新 Agent
1. 在 `AGENT_IDS` 中添加 ID
2. 在 `AGENT_DEFINITIONS` 中定义角色
3. 在 `ALLOWED_HANDOFF_TARGETS` 中配置交接目标
4. 更新 `HandoffPanel.tsx` 中的交接目标选择

### 修改交接流程
1. 更新 `tools.ts` 中的 `ALLOWED_HANDOFF_TARGETS`
2. 更新 `agents.ts` 中的 `HANDOFF_INSTRUCTION`
3. 检查 `HandoffPanel.tsx` 的前端验证

### 调试 Mock Server
```bash
# 本地启动 mock server
npm run mock:server

# 查看请求日志
curl http://localhost:3001/__admin/mocks
```

## 故障排查

### Agent 返回 401 Unauthorized
- 检查 `CODEBUDDY_BASE_URL` 是否指向 mock server
- 检查 mock server 是否包含 `/chat/completions` 端点
- 查看 mock server 日志确认请求路径

### 工具调用失败
- 检查工具名前缀是否为 `mcp__studio_tools__`
- 检查参数是否符合 zod schema
- 查看 `agent-manager.ts` 中的权限配置

### 数据未持久化
- 检查 `project_id` 是否正确传递
- 检查数据库文件权限
- 查看 `db.ts` 中的错误处理

## 提交规范

```bash
# 功能提交
feat: add xxx feature

# Bug 修复
fix: resolve xxx issue

# 文档更新
docs: update xxx documentation

# 测试相关
test: add xxx test case
```

## 联系方式

- 项目仓库：https://github.com/luoxiaojun1992/game-studio
