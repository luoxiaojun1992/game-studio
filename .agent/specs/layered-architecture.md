# 分层架构重构规范

> **SPEC-018** | 状态：设计中

## 目标

将 game-dev-studio server 端从单层巨石结构重构为干净的 **三层架构**，消除 `tools.ts` 与 `index.ts` 之间的业务逻辑重复，实现数据库访问、业务逻辑、接口层的彻底解耦。

### 核心问题

| 问题 | 现状 | 目标 |
|------|------|------|
| 巨石 DB 文件 | `server/db.ts` ~1830 行，混合 schema/类型/校验/80+ CRUD | 15 个聚焦的数据模块，每个 50-150 行 |
| 扁平 API 路由 | `server/index.ts` ~1290 行，所有路由内联 | 11 个域专属路由模块 |
| 业务逻辑重复 | 任务状态流转、交接状态机、提案校验在 `tools.ts` 和 `index.ts` 中重复实现 | 单一事实来源：service 层 |
| 直接 DB 访问 | 路由、工具、agent-manager、微服务客户端全部直接调用 `db.*` | DB 访问仅通过 data 层；业务逻辑仅通过 service 层 |
| 不可测试 | 无法脱离真实 SQLite 单测业务逻辑 | Service 通过 DI 接收 data 模块，支持 mock 单测 |

## 三层架构

```
                     ┌─────────────────┐
                     │   db-connection  │  (better-sqlite3 实例)
                     └────────┬────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
 ┌─────────────┐     ┌─────────────┐       ┌─────────────┐
 │  data/       │     │  data/       │       │  data/       │
 │  handoffs.ts │     │  proposals.ts│       │  games.ts    │  (15 个模块)
 └──────┬───────┘     └──────┬───────┘       └──────┬───────┘
        │                    │                      │
        └────────────┬───────┴──────────┬───────────┘
                     │                  │
                     ▼                  ▼
           ┌──────────────────────────────────┐
           │         services/                 │
           │  handoff-service.ts  (状态机)      │
           │  proposal-service.ts (生命周期)     │
           │  game-service.ts     (提交工作流)   │
           │  task-service.ts     (校验矩阵)     │
           │  ... (15 个服务)                   │
           └──────────────┬───────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼                       ▼
    ┌──────────────────┐    ┌──────────────────┐
    │     api/          │    │    tools.ts       │
    │  handoff-api.ts   │    │  (MCP handlers)   │
    │  proposal-api.ts  │    │  仅解析 + 调用     │
    │  game-api.ts      │    │  service + 格式化  │
    │  ... (11 routers) │    └──────────────────┘
    └──────────────────┘
```

### 依赖规则（不可违反）

- `data/` → 只 import `types.ts`, `validation.ts`, `constants.ts`, `better-sqlite3`
- `services/` → 只 import `data/` 模块 + 基础设施（MinIO、SSE、外部 HTTP）
- `api/` → 只 import `services/` + 基础设施
- `tools.ts` → 只 import `services/` + 基础设施
- `agent-manager.ts` → 只 import `services/` + 基础设施
- **绝对禁止循环依赖**（data 不 import services，services 不 import api）

## 数据层设计

将 `server/db.ts` 按表拆分为 15 个模块，每个模块使用工厂函数接收 `better-sqlite3.Database`：

```
server/data/
├── db-connection.ts          # 创建并导出 Database 实例
├── types.ts                  # 所有 TypeScript 接口
├── validation.ts             # 纯校验函数（无 DB 依赖）
├── constants.ts              # 状态枚举、正则模式、最大长度
├── index.ts                  # Barrel — 保持向后兼容
├── projects.ts               # projects + project_settings
├── proposals.ts              # proposals + proposal_attachments
├── games.ts                  # games
├── agent-sessions.ts         # agent_sessions
├── logs.ts                   # logs
├── commands.ts               # commands
├── permission-requests.ts    # permission_requests
├── handoffs.ts               # handoffs
├── agent-memories.ts         # agent_memories
├── task-board.ts             # task_board_tasks
├── file-storage.ts           # file_storages
├── blender-projects.ts       # blender_projects
├── drawio-projects.ts        # drawio_projects
├── image-projects.ts         # image_projects
├── game-engineering-specs.ts # game_engineering_specs + seed
└── file-helpers.ts           # resolveSafePath, ensureOutputDir
```

### 工厂模式

```typescript
// server/data/handoffs.ts
import type Database from 'better-sqlite3';
import type { DbHandoff } from './types.js';

export function createHandoffsModule(db: Database) {
  return {
    create(handoff: DbHandoff): DbHandoff { /* INSERT */ },
    getById(id: string): DbHandoff | undefined { /* SELECT */ },
    getAll(projectId: string, limit?: number): DbHandoff[] { /* SELECT */ },
    getPending(projectId: string, toAgentId?: string): DbHandoff[] { /* SELECT */ },
    getForAgent(projectId: string, agentId: string): { incoming: DbHandoff[]; outgoing: DbHandoff[] } { /* SELECT */ },
    update(id: string, updates: Partial<DbHandoff>): boolean { /* UPDATE */ },
  };
}
```

## 服务层设计

15 个服务按业务域分区：

### 核心业务服务（含复杂状态机）

| 服务 | 核心业务逻辑 | 依赖 data 模块 |
|------|-------------|--------------|
| `handoff-service.ts` | 状态机 pending→accepted→working→completed、autopilot 自动派发 | handoffs, projects, logs, agentSessions |
| `task-service.ts` | 状态转换校验矩阵、engineer finish guard、自动时间戳 | tasks, logs |
| `proposal-service.ts` | 创建→审核→决策生命周期、附件管理 | proposals, projects, logs, files |
| `game-service.ts` | version_number 自增、提交工作流 | games, projects, logs, files |

### 薄 CRUD 服务

| 服务 | 描述 |
|------|------|
| `agent-session-service.ts` | 会话生命周期（idle/working/paused/finished） |
| `agent-memory-service.ts` | 长期记忆 CRUD + category/importance 过滤 |
| `log-service.ts` | 横切日志抽象 |
| `command-service.ts` | 用户指令生命周期（pending→done） |
| `permission-service.ts` | 工具权限请求生命周期（pending→allowed/denied/expired） |

### 微服务包装

| 服务 | 对应微服务 | 状态 |
|------|----------|------|
| `blender-service.ts` | creator-service (Blender 3D 建模, 端口 8080) | 已实现 |
| `drawio-service.ts` | drawio-service (图表渲染, 端口 8082) | 已实现 |
| `image-service.ts` | image-service (ImageMagick 图片处理, 端口 8089) | 已实现 |

### 横切关注点

| 服务 | 描述 |
|------|------|
| `game-spec-service.ts` | 游戏工程规范查询 |
| `file-upload-service.ts` | 文件上传/下载编排（包装 MinIO） |
| `validation-service.ts` | 跨实体 DB 校验（如"提案是否可审核"） |

### Service Container（DI 容器）

```typescript
// server/services/index.ts
export function getServiceContainer(): ServiceContainer {
  const db = createDbConnection();
  // 实例化 15 个 data 模块
  const handoffs = createHandoffsModule(db);
  // ...
  // 实例化 15 个 service，注入 data 依赖
  return { handoff: createHandoffService({ handoffs, projects, logs, ... }), ... };
}
```

## API 层设计

从 `server/index.ts` 中提取路由到域专属模块：

```
server/api/
├── index.ts               # 创建 Express app，挂载所有路由
├── agent-api.ts            # /api/agents, /api/agents/:id/pause|resume|command
├── proposal-api.ts         # /api/proposals, /api/proposals/:id/*
├── game-api.ts             # /api/games, /api/games/:id
├── handoff-api.ts          # /api/handoffs, /api/handoffs/:id/*
├── task-api.ts             # /api/tasks, /api/tasks/:id/status
├── project-api.ts          # /api/projects, /api/projects/:id/settings
├── memory-api.ts           # /api/memories, /api/agents/:id/memories
├── log-api.ts              # /api/projects/:id/logs
├── command-api.ts          # /api/commands
├── observation-api.ts      # /api/observe (SSE)
├── file-storage-api.ts     # /api/file-storage/*
├── middleware.ts            # CORS, JSON parsing, error handling
└── validators.ts           # 请求校验辅助
```

### 路由模式

每个路由遵循：**解析请求 → 调用 service → 格式化响应**

```typescript
router.post('/api/handoffs/:id/accept', async (req, res) => {
  try {
    const handoff = await services.handoff.acceptHandoff(req.params.id);
    res.json({ handoff });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

## 业务逻辑迁移表

当前重复在 `index.ts` 和 `tools.ts` 中的逻辑迁移到各自 service：

| 业务规则 | 当前位置 | 目标位置 |
|---------|---------|---------|
| 任务状态流转校验 | index.ts, tools.ts | `task-service.ts` |
| 交接状态机 | index.ts L624-751, tools.ts L247-297 | `handoff-service.ts` |
| Autopilot 自动派发 | index.ts L587-621, tools.ts L253-288 | `handoff-service.ts` |
| Engineer 完成前置检查 | agent-manager.ts L298-309 | `task-service.ts` |
| 交接目标校验 | tools.ts L155-162 | `handoff-service.ts` |
| 提案类型对 agent 校验 | tools.ts L464-474 | `proposal-service.ts` |
| Game version_number 自增 | db.ts L739-741 | `game-service.ts` |
| 问卷提案组装 | index.ts L960-1100 | `proposal-service.ts` |
| Content XSS 过滤 | index.ts POST /proposals, tools.ts submit_proposal | `proposal-service.ts` |

## 实施策略

### 分 5 个阶段渐进迁移，向后兼容

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
 基础      数据层     服务层     API 路由    AgentMgr    清理
```

### Phase 0: Foundation
- 提取 `types.ts`、`constants.ts`、`validation.ts` → `server/data/`
- 创建 `db-connection.ts` 和 `index.ts` barrel
- `db.ts` 改为从新文件 import 并 re-export
- **零行为变更，所有现有 import 继续工作**

### Phase 1: Data Layer（15 个模块，从简单到复杂）
提取顺序：game-engineering-specs → blender → drawio → image → file-storage → commands → permissions → logs → agent-memories → agent-sessions → task-board → games → proposals → projects → handoffs

### Phase 2: Service Layer（15 个服务）
创建数据模块之上的 service，迁移 index.ts/tools.ts 中的业务逻辑。

### Phase 3: API Routes
从 index.ts 提取路由到 `server/api/*.ts` 域模块。

### Phase 4: Agent Manager
通过构造器 DI 注入 service，替换所有 `db.*` 调用。

### Phase 5: Cleanup
删除旧 `db.ts`、重复校验、完成文档。

### 每个 module 完成后
- `npm run build:server` 通过
- 运行 Playwright E2E 冒烟测试
- 提交

## 风险控制

| 风险 | 缓解措施 |
|------|---------|
| 破坏 E2E 测试 | Barrel export 保持完全相同的签名；每个模块后运行测试 |
| 循环依赖 | 严格遵守单向：data → services → api |
| 性能退化 | 同一 `better-sqlite3` 实例，函数调用零抽象开销 |
| Agent manager 破坏 | 运行时状态（Maps）留在 agent-manager，仅 DB 访问委托给 service |
| Tool handler 回归 | Zod schema 不变；逐个 tool 验证响应格式 |
| 构建失败 | 已在用 `.js` 扩展名 + NodeNext 解析，无需变更 |

## 测试策略

1. **单元测试**（新增）：Service 层通过 mock data 模块进行纯逻辑测试，无需真实 SQLite
2. **E2E 测试**：每个 Phase 完成后运行 Playwright 冒烟测试，确保功能无回归
3. **构建验证**：`npm run build:server` + `npm run build` 通过

## UI Test 验收规则

提交代码前必须跑通 ui test。
如遇网络或依赖问题，可临时修改代码解决网络问题，但禁止提交为了解决网络依赖问题所做的变更。

## 主动补全 UI Test 规范

新增前端交互功能（按钮、表单、弹窗、面板等）时，必须同步编写对应的 E2E 测试用例，并更新以下文档：
1. `tests/ui/e2e/studio.spec.ts` — 添加测试用例（分配下一个 UI-XXX 编号）
2. `.agent/memory/E2E_TESTING.md` — **必须同步更新以下 3 处**：
   - 测试矩阵标题数字（如 `12 个用例` → `13 个用例`）
   - 测试矩阵表格（新增 UI-XXX 行）
   - ui-coverage 覆盖率引用（如有）
3. `tests/ui/artifacts/ui-coverage-summary.json` — 更新 `totalCases`/`coveredCases` 数字
4. `.agent/specs/` 下对应的 spec 文档 — 更新测试策略章节
5. `.agent/specs/INDEX.md` — 如有新 spec 则更新索引

## 主动更新所有相关文档规范

实现新功能或做重大修改后，必须主动检查并更新所有受影响的文档，而非仅更新直接相关文件。完整检查清单：
1. `README.md` + `README.zh-CN.md` — 目录结构更新
2. `docs/ARCHITECTURE.md` + `docs/ARCHITECTURE.zh-CN.md` — 架构分层描述
3. `.agent/memory/ARCHITECTURE.md` — 三层架构关键点
4. `.agent/memory/INDEX.md` — 快速参考
5. `.agent/memory/E2E_TESTING.md` — 测试矩阵（如有新测试）
6. `.agent/memory/CONVENTIONS.md` — 工作约定（如有新规范）
7. `.agent/memory/MEMORY.md` — 长期记忆（工程决策记录）
8. `.agent/specs/` 下相关 spec 文档 — 状态更新
9. `.agent/specs/INDEX.md` — spec 索引状态
10. `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` — 关键文件位置、API 概览
- **文档更新禁止添加日期和敏感信息**
- **不相关的文档不需要修改**

## 详细 Debug 日志规范

新增前端交互功能、后端 API 路由、E2E 测试用例时，必须同步添加 `console.log` / `process.stderr.write` debug 日志，方便测试失败时快速定位问题：

1. **后端 API 路由**：在路由入口、校验步骤（PASS/FAIL）、关键操作（DB 写入、SSE 广播）处添加 `console.log('[DEBUG:路由名] stepN: ...')` 格式日志
2. **前端组件**：在关键生命周期（mount）、用户操作（表单填写、校验、提交）、API 请求/响应处添加 `console.log('[DEBUG:ComponentName] ...')` 格式日志
3. **SSE 事件处理**：在 `handleSSEEvent` 的 case 分支中添加日志，记录事件类型和关键数据
4. **E2E 测试用例**：参照 UI-007/008 的 `log()` helper 模式，每个操作步骤添加 `process.stderr.write('[UI-XXX] step: ...')` 日志，包含结构化 extra 数据
   - **日志格式统一**：`[DEBUG:模块名] stepN: 描述` 或 `[UI-XXX] stepN: 描述`，关键数据以 JSON extra 输出
   - **日志粒度**：关键路径全覆盖，但避免在循环/高频回调中输出日志

## 相关文件

| 文件 | 角色 |
|------|------|
| `server/db.ts` | 重构目标：薄 barrel re-export |
| `server/index.ts` | 重构目标：薄 app assembler |
| `server/tools.ts` | 重构目标：service 调用替代 db 调用 |
| `server/agent-manager.ts` | 重构目标：DI 注入 service |
| `server/data/*.ts` | 新增：15 个数据模块 + types/constants/validation |
| `server/services/*.ts` | 新增：15 个业务逻辑服务 |
| `server/api/*.ts` | 新增：11 个域路由模块 |
| `server/file-storage.ts` | 重构目标：拆分为 data + api |
| `server/creator-service.ts` | 重构目标：合并入 services/blender-service.ts |
| `server/drawio-service.ts` | 重构目标：合并入 services/drawio-service.ts |
| `server/image-service.ts` | 重构目标：合并入 services/image-service.ts |
| `server/proposal-attachments-api.ts` | 重构目标：合并入 api/proposal-api.ts |
| `tsconfig.server.json` | 路径别名（可选） |
| `tests/ui/e2e/studio.spec.ts` | E2E 测试不变 |
| `.agent/specs/layered-architecture.md` | 本 spec |
| `.agent/specs/INDEX.md` | 索引 |
