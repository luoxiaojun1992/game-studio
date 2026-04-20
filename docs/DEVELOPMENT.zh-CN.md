# Game Dev Studio 开发指南

[English](./DEVELOPMENT.md)

本指南基于当前仓库实现，聚焦真实代码结构与扩展入口。

## 1. 架构总览

### 1.1 运行形态

- 前端：React + Vite（`src/`）
- 后端：Express（`server/index.ts`）
- AI 编排：`agent-manager.ts` + `tools.ts` + Agent SDK
- Studio 联动：`star-office-sync.ts`（Agent 注册、状态同步、健康巡检）
- 数据层：SQLite（`server/db.ts`）
- 静态分析：可扩展 Lint 框架（`server/lint/`）
- 实时观测：SSE（`/api/observe` + `sse-broadcaster.ts`）

### 1.2 关键设计

- **项目隔离**：大部分业务实体都带 `project_id`
- **事件驱动 UI**：后端广播事件，前端消费 `SSEEvent`
- **Agent 自定义工具**：通过 MCP Server 注入工作室专属工具
- **产物落盘**：提案、游戏同步写入 `output/{project_id}` 目录

## 2. 代码结构

```text
server/
  index.ts               # REST API + SSE + 静态产物服务
  agent-manager.ts       # Agent 状态、消息发送、权限请求
  tools.ts               # MCP 自定义工具定义与权限规则
  lint/                  # 可扩展 Lint 框架（LintRunner、可插拔检查器）
  agents.ts              # 角色定义、系统提示词、工具使用约束
  star-office-sync.ts    # Star-Office-UI 注册与状态同步
  db.ts                  # 建表、迁移、查询与写入
  sse-broadcaster.ts     # SSE 客户端管理与广播

src/
  pages/StudioPage.tsx   # 主页面与 SSE 事件分发
  components/            # 团队总览/Studio/提案/任务/交接/游戏/日志/指令
  config.ts              # API 调用封装
  types.ts               # 业务模型与 SSE 事件类型
```

## 3. 数据模型（SQLite）

核心表（`server/db.ts`）：

- `projects`：项目基础信息
- `project_settings`：项目级配置（含 `autopilot_enabled`）
- `agent_sessions` / `agent_messages`：Agent 会话与消息
- `proposals`：提案与审批状态
- `games`：游戏成品（`html_content` 或 `file_storage_id`）
- `file_storages`：打包产物在 MinIO 的元数据
- `logs`：统一日志（系统日志 + Agent 输出日志，通过 `log_type` 区分）
- `commands`：指令执行记录
- `permission_requests`：工具权限审批请求与响应记录
- `handoffs`：任务交接
- `task_board_tasks`：任务看板（开发/测试）
- `agent_memories`：长期记忆

建议：

- 新增字段时同步补充迁移逻辑（参照 `ensureProjectColumns` / `ensureProjectIsolationColumns`）。
- 对高频查询字段补索引。

## 4. API 与事件

### 4.1 常用 API（后端入口：`server/index.ts`）

- 系统：`GET /api/health`，`GET /api/models`，`GET /api/check-login`
- 观测：`GET /api/observe`（SSE）
- Agent：查询、消息查询/清理、暂停/恢复、发送指令（team_builder 不支持暂停/恢复与手动指令）
- 提案：创建、查询、评审、用户决策
- 游戏：提交、查询、预览、状态更新
- 任务：创建、查询、状态更新
- 交接：创建、接受、确认执行、完成、拒绝、取消
- 记忆：按 Agent 或项目查询/新增/删除
- 项目：创建、查询、项目切换（`POST /api/projects/switch`）、项目设置读取/更新（`autopilot_enabled`）
- 日志：`GET/DELETE /api/projects/:projectId/logs`
- 指令：`GET /api/commands`
- 权限：`POST /api/permission-response`

### 4.2 SSE 事件（前端消费：`StudioPage.tsx`）

关键事件：

- `init`
- `agent_status_changed`
- `stream_event`（含文本流、权限请求等）
- `agent_paused` / `agent_resumed`
- `proposal_created` / `proposal_reviewed` / `proposal_decided`
- `game_submitted` / `game_updated`
- `handoff_created` / `handoff_updated`
- `task_created` / `task_updated`
- `logs_cleared`

## 5. Agent 与 MCP 自定义工具

### 5.1 团队角色

定义于 `server/agents.ts`：

- `engineer`
- `architect`
- `game_designer`
- `biz_designer`
- `ceo`
- `team_builder`

每个角色包含：

- 职责与系统提示词
- 可移交目标（`handoffTargets`）
- 对工具使用的流程约束（尤其工程师任务流）

### 5.2 当前工具集（`server/tools.ts`）

- `save_memory`
- `get_memories`
- `create_handoff`
- `split_dev_test_tasks`
- `get_tasks`
- `update_task_status`
- `submit_proposal`
- `submit_game`
- `get_agent_logs`
- `get_agents`
- `get_proposals`
- `get_pending_handoffs`
- `get_project_latest_info`（仅 team_builder 可用）

关键约束：

- `update_task_status` 仅接受完整 UUID `task_id`
- 任务状态流转受限（`todo -> developing -> testing -> done`，含 `blocked` 分支）
- 交接目标存在角色白名单
- 交接链路受角色约束：`game_designer -> ceo -> architect -> engineer -> biz_designer`
- `submit_game` 支持两种输入：`html_content` 或 `file_path`（仅允许 `output/{project_id}` 目录内路径）

### 5.3 Star Office 同步机制（`server/star-office-sync.ts`）

- 服务启动时尝试注册项目下全部 Agent（含 `team_builder`，按 `project_id` 维度管理）
- 状态同步支持防抖（`STAR_OFFICE_SYNC_DEBOUNCE_MS`）
- 包含健康检查与在线状态巡检（`STAR_OFFICE_HEALTH_CHECK_INTERVAL_MS`）
- 默认基于 `STAR_OFFICE_UI_URL` 推导 `/set_state`、`/agent-push`、`/join-agent`、`/agents`、`/health`

## 6. 前端扩展点

### 6.1 新增面板

1. 在 `src/types.ts` 扩展 `TabKey` 与类型
2. 在 `StudioPage.tsx` 的 `TABS` 增加标签
3. 新建 `src/components/*.tsx`
4. 在 `StudioPage.tsx` 中接入渲染与事件处理

当前内置标签中已包含 `pixel_studio`（对应 `StarOfficeStudio.tsx`），新增标签时建议沿用该模式接入。

### 6.2 新增 API 调用

1. 后端在 `server/index.ts` 增加路由
2. 前端在 `src/config.ts` 增加调用封装
3. 需要实时更新时，补充 SSE 广播与前端事件分支

## 7. 后端扩展点

### 7.1 新增 REST 端点

- 统一走 `/api/*`
- 增加参数校验与错误返回
- 涉及项目数据必须走 `project_id` 隔离

### 7.2 新增自定义工具

1. 在 `server/tools.ts` 增加 `tool(...)` 定义
2. 必要时加入角色权限校验
3. 需要 UI 实时更新时广播 SSE 事件
4. 在 `server/agents.ts` 的工具说明中补充新工具用途

### 7.3 新增 Lint 检查器

Lint 框架采用**可插拔注册式架构**（`server/lint/`）：

1. 在 `server/lint/checkers/*.ts` 创建新文件
2. 实现 `LintChecker` 接口（id、name、description、`check()` 方法）
3. 在 `server/lint/checkers/index.ts` 注册（加入 `builtInCheckers` 数组）
4. 内置检查器：`html-structure`（6 条 error 规则）+ `js-security`（4 条 warn 规则）
5. error 级别 issue **阻断** `submit_game`，warn 级别仅记录日志
6. HTML 模式检查 `html_content`；ZIP 模式会逐个检查包内 HTML，遇到首个 error 即阻断

## 8. 本地开发与构建

```bash
# 安装依赖
npm install

# 前后端联调
npm run dev

# 构建（tsc + vite）
npm run build
```

### 8.1 推荐环境变量

- 模型鉴权：`CODEBUDDY_API_KEY`（或运行环境注入 `CODEBUDDY_AUTH_TOKEN`）
- 前端 API：`VITE_API_BASE`（默认 `http://localhost:3000`）
- Studio 页面地址：`VITE_STAR_OFFICE_UI_URL`
- 后端同步地址：`STAR_OFFICE_UI_URL`（默认 `http://127.0.0.1:19000`）
- Agent 注册密钥：`STAR_OFFICE_JOIN_KEY`

## 9. 调试建议

- API 调试：直接查看 `server/index.ts` 对应端点与参数来源（query/body）
- SSE 调试：浏览器 Network 中观察 `/api/observe` EventStream
- 数据调试：查看 `data/studio.db` 中对应表数据
- 工具链路调试：检查 `server/tools.ts` 的校验分支与日志输出
- Studio 联调：查看 `src/components/StarOfficeStudio.tsx` 的 iframe 加载状态与地址校验提示

## 10. 常见注意事项

- 修改任务看板逻辑时，前后端都要同步更新状态定义与流转规则（`todo -> developing -> testing -> done`，含 `blocked`）
- 新增事件时，记得更新 `src/types.ts` 的 `SSEEvent` 联合类型
- 游戏预览接口直接返回 HTML，注意内容安全与来源可控
- 产物写盘逻辑在 `db.ts`，改路径规则时需兼容历史数据
- 项目切换时会触发 Star Office 同步，若联调异常优先检查 `/api/projects/switch` 与 `star-office-sync.ts` 日志
