# Game Dev Studio - AI Agent Common Instructions

> 本文档是公共 instruction 唯一真源（SSOT）。
> `.workbuddy` 与 `.github` 下的 instruction 只保留必要入口与索引，并引用本文件。

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
- 自定义工具 schema 不再要求显式传入 `project_id` 参数
- `createStudioToolsServer(projectId, ...)` 会注入 `scopedProjectId` 作为安全锚点，工具内部统一使用该作用域执行项目隔离，拒绝跨项目操作
- Star-Office 同步为多项目持续同步模型，`/api/projects/switch` 不再触发 Agent offline/online 同步切换

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
- 工具名前缀为 `mcp__studio_tools__`（下划线）
- 建模工具已并入单一 studio-tools（`blender_*`），并仅对 `engineer` 角色开放
- 记忆通过 `getMemorySummaryForPrompt()` 注入 systemPrompt

### 4. 关键文件位置

| 功能 | 文件路径 |
|------|----------|
| Agent 管理器 | `server/agent-manager.ts` |
| Agent 定义 | `server/agents.ts` |
| 自定义工具 | `server/tools.ts` |
| Creator 集成 | `server/creator-service.ts`、`creator/` |
| 数据库操作 | `server/db.ts` |
| 文件存储 | `server/file-storage.ts`、`server/minio-client.ts` |
| Lint 框架 | `server/lint/`（LintRunner + 可插拔检查器） |
| SSE 广播 | `server/sse-broadcaster.ts` |
| Express 路由 | `server/index.ts` |

## 编码规范

### TypeScript
- 使用 ES Module (`"type": "module"`)
- 后端文件使用 `.ts` 扩展名，运行时通过 `tsx` 编译
- 避免循环依赖（已通过 sse-broadcaster.ts 解耦）

### 数据库
- 使用 `better-sqlite3` 的同步 API
- 核心业务表通过 `project_id` 进行项目隔离（部分表通过会话/关联键间接归属项目）
- 关键表：`projects`、`project_settings`、`agent_sessions`、`proposals`、`games`、`handoffs`、`task_board_tasks`、`agent_memories`、`logs`、`commands`、`permission_requests`
- `games` 已移除 `author_agent_id`；`logs`/`commands`/`permission_requests` 均要求 `updated_at`

### 环境变量
```bash
# 核心变量
CODEBUDDY_BASE_URL=http://localhost:3001  # Mock server 或真实 API
CODEBUDDY_API_KEY=your-api-key
PORT=3000                                  # 后端端口

# 可选变量
STAR_OFFICE_UI_URL=http://127.0.0.1:19000  # Star-Office-UI 地址
SONARQUBE_PORT=9002                        # SonarQube 服务端口
SONARQUBE_TOKEN=sonarpass                  # SonarQube 检查器访问 token（未配时使用默认值）
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
   - 表结构变更优先更新 `CREATE TABLE` DDL（保证新库即正确）
   - 仅在存在历史数据补齐/兼容场景时再补充迁移逻辑
   - 新增字段需提供默认值

### ⚠️ 工作红线（强制遵守）
- **禁止 workaround**：任何修改必须基于正确的根因分析，逻辑正确是底线
- 遇到问题必须先定位根因，再修复，不能猜测或碰运气
- **不允许为了"让测试通过"而放宽断言、加 fallback、或绕过正常流程**
- **tool 参数契约必须与当前 schema 严格一致**：`project_id` 已从工具入参移除，mock 与真实调用都不要再显式传该字段

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
docker compose -f docker-compose.ui-test.yml up --build -d

# 查看测试日志
docker compose -f docker-compose.ui-test.yml logs ui-e2e

# 仅运行测试（不构建）
docker compose -f docker-compose.ui-test.yml run --rm ui-e2e

# 本地运行测试
npm run test:ui
```

**E2E 调试关键原则**：
- **选择器不匹配** → 前端加 `data-testid` → 测试用属性选
- **gameCount=0**：高频根因是 mock 的 `toolCalls.arguments` 与当前 zod schema 不一致（如仍传 `project_id` 或缺必填字段）
- **SSE reconnect bug**：`connectedRef.current` 阻止切换项目后重连

### Mock Server
- 路径：`/chat/completions` (不是 `/v1/chat/completions`)
- 支持流式 (SSE) 和非流式响应
- 管理端点：`/__admin/mocks`, `/__admin/reset`

## 常见任务指南

> 下面提到的文档路径均按“仓库根目录”理解（非当前文件目录）。

### 添加新工具
1. 在 `server/tools.ts` 中使用 `tool()` 定义
2. 添加 zod schema 参数验证（确保入参与当前工具契约一致，不要引入冗余字段）
3. 在 `agents.ts` 的 `TOOLS_OVERVIEW` 中描述工具用途
4. 如需自动授权，在 `agent-manager.ts` 的 `CAN_AUTO_ALLOW` 中添加

### 添加新 Lint 检查器
1. 在 `server/lint/checkers/` 下新建文件，实现 `LintChecker` 接口（来自 `types.ts`）
2. 在 `server/lint/checkers/index.ts` 的 `builtInCheckers` 数组中注册
3. `LintChecker.check()` 支持 `LintIssue[] | Promise<LintIssue[]>`，异步检查器需返回 Promise 并由框架统一 await
4. `sonarqube` 为现有内置检查器之一，依赖本地 SonarQube 服务（默认 `http://localhost:9002`）
4. 详见 `.agent/memory/LINT.md` 扩展指南

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
- 检查工具名前缀是否为 `mcp__studio_tools__`（下划线）
- 检查参数是否符合 zod schema（特别注意：不要继续传已移除的 `project_id`）
- 查看 `agent-manager.ts` 中的权限配置

### 数据未持久化
- 检查工具是否在当前项目作用域下执行（`createStudioToolsServer` 注入 `scopedProjectId`，工具内不再读取 `project_id` 入参）
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

## 经验文档索引

> 下列路径均为仓库根目录相对路径。

详细调试经验、历史踩坑记录见仓库内 `.agent/memory/` 目录：

| 文档 | 内容 |
|------|------|
| `.agent/memory/INDEX.md` | 经验快速索引 |
| `.agent/memory/E2E_TESTING.md` | UI-007/008 调试经验、选择器原则 |
| `.agent/memory/SDK_MOCK.md` | Mock Server 架构、Agent systemPrompt |
| `.agent/memory/CONVENTIONS.md` | 工作红线、Bug 修复记录 |
| `.agent/memory/ARCHITECTURE.md` | 项目架构、关键文件 |
| `.agent/memory/LINT.md` | 可扩展 Lint Framework 架构、检查器、扩展指南 |
| `.agent/memory/REUSABLE_PATTERNS.md` | 可复用代码片段、代码模板、设计模式汇总 |
