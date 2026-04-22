# 项目架构

## 项目概述
- 游戏开发 Agent 团队观测控制台
- 技术栈: Express + SQLite + React + TypeScript + Tailwind + TDesign
- 端口: 后端 3000, 前端 5173

## 架构关键点
- `server/db.ts` - SQLite 所有数据操作
- `server/tools.ts` - SDK Custom Tools（MCP 自定义工具）
- `server/creator-service.ts` - Creator 服务调用封装（Blender 项目/文件生命周期）
- `server/lint/` - 可扩展静态检查框架（LintRunner + 可插拔 checker）
- `server/lint/types.ts` - 核心类型：LintChecker 接口、LintIssue、LintResult
- `server/lint/index.ts` - LintRunner 运行时 + lintGameContent() 便捷入口
- `server/lint/checkers/html-structure.ts` - HTML 结构检查器（6 条 error 规则）
- `server/lint/checkers/js-security.ts` - JS 安全检查器（4 条 warn 规则）
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
- 内置工具覆盖记忆、任务拆分、任务看板、交接、提案、游戏提交、日志查询等核心流程（以 `server/tools.ts` 为准）
- Blender 建模工具（`blender_*`）已并入同一 studio-tools server，由 `creator-service.ts` 统一调用 creator API
- 所有工具调用都要求显式传入 project_id，并通过 scopedProjectId 做一致性校验

## Agent 角色
- 6 个 Agent: `game_designer`, `architect`, `engineer`, `biz_designer`, `ceo`, `team_builder`
- `team_builder` 每个 agent 结束后运行，负责总结沉淀记忆，handoffTargets 为空数组

## canUseTool 放行规则
- studio-tools 前缀为 `mcp__studio_tools__`；内部按白名单自动放行
- `blender_*` 工具仅 `engineer` 自动放行，其他角色默认不放行

## DB 初始化注意事项
- `MAX_PROJECT_ID_LENGTH` 等常量必须放在文件顶部，在任何函数调用之前完成初始化
- 曾因初始化顺序错误导致 db 初始化失败

## Agent Session 隔离
- Agent 会话通过 URL 路由参数 `agentId` 区分
- 每个 Agent 有独立的 session，状态互不影响

## 代码学习笔记

### 项目整体结构
```
game-dev-studio/
├── data/                 # SQLite 数据库文件
├── dist/                 # 构建输出
├── docs/                 # 项目文档（中英双语）
├── output/               # 生成的游戏和提案文件
├── server/               # Express 后端
│   ├── index.ts         # API 入口，SSE 流
│   ├── db.ts            # 数据库模型与操作
│   ├── tools.ts         # MCP 自定义工具定义
│   ├── agent-manager.ts # Agent 状态管理与消息传递
│   ├── sse-broadcaster.ts # SSE 广播服务
│   ├── star-office-sync.ts # 与 Star‑Office‑UI 同步
│   └── agents.ts        # Agent 角色定义与系统提示词
├── src/                  # React 前端
│   ├── pages/StudioPage.tsx     # 主页面（多标签布局）
│   ├── components/              # 可复用 UI 组件
│   │   ├── AgentCard.tsx        # Agent 状态卡片
│   │   ├── CommandPanel.tsx     # 指令发送面板
│   │   ├── HandoffPanel.tsx     # 任务交接面板
│   │   ├── ProposalList.tsx     # 提案列表
│   │   ├── GameList.tsx         # 游戏列表
│   │   ├── TaskBoardPanel.tsx  # 任务看板
│   │   ├── LogPanel.tsx         # 日志面板
│   │   └── StarOfficeStudio.tsx # Star‑Office‑UI 集成组件
│   ├── types.ts          # TypeScript 类型定义
│   ├── config.ts         # API 配置
│   └── i18n.ts           # 国际化支持
├── star-office-ui/       # Star‑Office‑UI 子模块（用于同步）
├── creator/              # Blender Creator 微服务（FastAPI）
├── tests/                # 测试文件
│   ├── ui/               # UI E2E 测试（Playwright）
│   │   ├── e2e/studio.spec.ts    # 主测试用例
│   │   └── coverage/cases.json   # 测试覆盖定义
│   └── mock-server/      # Mock Server（模拟 SDK 行为）
│       └── codebuddy-sdk-mock-server.mjs
├── docker-compose.yml    # 主服务编排
├── docker-compose.ui-test.yml # UI 测试编排
├── Dockerfile.backend    # 后端 Dockerfile
├── Dockerfile.frontend   # 前端 Dockerfile
└── package.json          # 依赖与脚本
```

### 关键模块详解

#### 1. 后端 API (`server/index.ts`)
- 提供完整的 RESTful API，支持项目、Agent、提案、游戏、任务、交接、日志等资源的 CRUD。
- 统一的项目 ID 规范化与验证（`normalizeProjectId`）。
- SSE 端点 (`/api/observe`)：推送项目级实时事件（Agent 状态变化、提案更新、游戏提交等）。
- 自动交接（autopilot）与手动交接的逻辑分流。
- 任务看板状态机 (`TASK_STATUS_FLOW`) 确保合法的状态流转。

#### 2. 数据库层 (`server/db.ts`)
- 使用 **better‑sqlite3** 驱动，WAL 模式，外键启用。
- 核心表：`projects`、`project_settings`、`agent_sessions`、`agent_messages`、`proposals`、`games`、`handoffs`、`task_board_tasks`、`logs`、`commands`。
- 每个表均通过 `project_id` 字段实现多项目隔离。
- 提供原子化的增删改查函数，以及文件导出功能（`saveProposalToFile`、`saveGameToFile`）。

#### 3. 工具定义 (`server/tools.ts`)
- 通过 `createSdkMcpServer` 创建 MCP Server，暴露覆盖完整工作流的自定义工具：
  - `save_memory`：保存长期记忆（分类、重要性、关联任务）。
  - `get_memories`：获取指定 Agent 的记忆。
  - `create_handoff`：创建任务交接（来源、目标、标题、描述、上下文、优先级）。
  - `submit_proposal`：提交提案（类型、标题、内容、作者）。
  - `submit_game`：支持双模式提交游戏（`html_content` 或 `file_path`，文件模式会打包 ZIP 并上传 MinIO）。
  - `get_games`：按时间倒序获取当前项目游戏列表，返回基础元信息与模式标记。
  - `get_game_info`：按游戏 ID 获取详情；HTML 模式返回完整 HTML，文件模式返回 MinIO 预签名下载链接。
  - `get_proposals`：获取当前项目的提案列表。
  - `get_pending_handoffs`：获取待处理的交接任务。
- **项目隔离**：每个工具都要求传 `project_id`，并通过 `requireProjectId` 校验其与 `scopedProjectId` 一致，拒绝跨项目。
- **权限检查**：部分工具（如 `submit_proposal`）会验证调用 Agent 的角色是否允许执行该操作。
- **产物存储**：文件模式通过 `file_storage_id` 关联 `file_storages` 元数据并提供下载能力。

#### 4. Agent 管理器 (`server/agent-manager.ts`)
- 维护每个项目中每个 Agent 的运行时状态（idle、working、paused、error）。
- 通过 `sendMessage` 方法将用户指令转发给对应的 Agent，并流式返回结果。
- 集成 MCP Server：为每个 Agent 会话创建独立的工具服务器实例。
- 权限请求机制：当 Agent 尝试使用敏感工具时，向 UI 发起权限请求，等待用户批准/拒绝。
- 事件驱动：状态变化、流事件、暂停/恢复等均通过 EventEmitter 通知 SSE 广播器。

#### 5. SSE 广播器 (`server/sse-broadcaster.ts`)
- 解耦循环依赖的中间层，负责将后端事件广播给所有订阅的 SSE 客户端。
- 按项目 ID 分组客户端，实现项目级的事件隔离。
- 心跳机制保持连接活跃。

#### 6. Star‑Office‑UI 同步 (`server/star-office-sync.ts`)
- 通过 HTTP 调用 Star‑Office‑UI 的 API，实现项目状态的实时同步。
- 支持切换项目、同步 Agent 状态、同步提案/游戏/任务等数据。
- 启动时全量同步，运行时增量同步。

#### 7. 前端主页面 (`src/pages/StudioPage.tsx`)
- 多标签布局（团队总览、团队建设、Studio、策划案、任务看板、任务交接、配置中心、游戏成品、运行日志、指令中心）。
- 通过 SSE 连接接收实时数据，更新各面板状态。
- 支持中英双语切换。
- 集成 Star‑Office‑UI 组件，实现双端联动。

#### 8. E2E 测试 (`tests/ui/e2e/studio.spec.ts`)
- 使用 Playwright 编写，覆盖 8 个核心场景：
  - UI‑001: 页面加载与基础布局
  - UI‑002: 项目切换与状态同步
  - UI‑003: 团队建设 Agent 流程
  - UI‑004: 游戏策划 Agent 流程
  - UI‑005: 架构师 Agent 流程
  - UI‑006: 软件工程师 Agent 流程
  - UI‑007: 游戏提交与列表更新
  - UI‑008: 任务看板与状态流转
- 每个场景均包含前置条件、操作步骤、预期结果。
- 依赖 Mock Server 模拟 SDK 行为，确保测试可重复、不依赖外部服务。

##### E2E 测试架构
- **测试框架**: Playwright + TypeScript
- **Mock 服务**: `tests/mock-server/codebuddy-sdk-mock-server.mjs`（per-agent 路由队列）
- **Docker 编排**: `docker-compose.ui-test.yml`（5 个服务）
- **测试入口**: `tests/ui/e2e/studio.spec.ts`（9 个用例）
- **核心模式**: `runFullWorkflowTest()` — 目标状态驱动的事件循环，UI-007/008 共用
- **数据流**: 测试 → Mock Admin API (port 3001) → 预设响应队列 → Agent 调用 /chat/completions → 匹配 (projectId, agentRole) → 返回预设响应

###### Docker 服务依赖图
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

###### 前端组件 data-testid 架构
- 所有可交互元素统一使用 `data-testid` 属性
- 动态 ID 格式：`handoff-card-${id}`、`proposal-item-${id}`、`game-card-${id}`、`tab-${key}`
- 状态属性：`data-handoff-status`、`data-agent-to`、`data-agent-from`、`data-game-name`
- 详见 E2E_TESTING.md 完整对照表

#### 9. Mock Server (`tests/mock-server/codebuddy-sdk-mock-server.mjs`)
- 模拟 `@tencent‑ai/agent‑sdk` 的 `query` 接口，用于 UI 测试。
- 内置固定的响应逻辑，例如 `submit_game` 返回成功、`create_handoff` 生成交接记录等。
- 通过环境变量 `CODEBUDDY_BASE_URL` 切换真实 SDK 与 Mock。

### 数据流与状态管理

1. **用户操作** → 前端调用 API → 后端更新数据库 → 广播 SSE 事件 → 前端刷新 UI。
2. **Agent 工作流**：
   - 用户通过 CommandPanel 向指定 Agent 发送指令。
   - AgentManager 创建该 Agent 的 SDK 会话，注入工具服务器。
- Agent 调用工具（如 `submit_game`）时需传 `project_id`，工具校验通过后再按该项目写入数据库。
   - 数据库变更触发 SSE 广播，前端实时更新游戏列表。
3. **任务交接流**：
   - 源 Agent 调用 `create_handoff` 创建交接记录。
   - 若项目开启自动交接（autopilot），目标 Agent 立即收到消息并开始执行。
   - 否则，交接状态为 `pending`，等待目标 Agent 手动接受。
4. **状态机约束**：
   - 任务看板：`todo → developing → testing → done`（允许 `blocked` 分支）。
   - 提案评审：`pending_review → under_review → approved/rejected`（用户可覆盖决策）。

### 指令中心、Agent 切换与状态保存

#### 1) 指令中心当前目标 Agent 的前端切换链路
- 总览页（`StudioPage` 的 `overview` Tab）点击 `AgentCard` 的「发送指令」会执行 `setCommandTargetAgent(agent.id)` 并切到 `commands` Tab（`src/pages/StudioPage.tsx`）。
- `CommandPanel` 通过 `selectedAgentId` 接收外部指定 Agent；若变化则同步内部 `selectedAgent` 并写入 localStorage。
- 用户在 CommandPanel 左侧手动切换 Agent 时，`onAgentChange` 回传给 `StudioPage`，形成双向同步。

#### 2) 指令中心“当前 Agent”持久化（UI 层）
- 持久化介质是浏览器 localStorage，键名按项目隔离：`commandPanel_lastAgent_${projectId}`。
- `StudioPage` 在 `agents/selectedProjectId` 变化时读取该键，恢复 `commandTargetAgent`。
- `CommandPanel` 初始化时优先读取该键；无有效值时回退到：
  1. 当前处于 `working` 的可指令 Agent；
  2. 第一个可指令 Agent；
  3. `game_designer`（兜底）。
- `team_builder` 不允许作为指令目标；若命中无效或被过滤，会自动回退并覆盖存储值。
- 原因： 该角色定位为“会话后总结 / 记忆沉淀”后台 Agent（由系统触发），不承载人工下达日常执行指令。

#### 3) Agent 运行状态持久化（后端层）
- 后端真实状态由 `AgentManager` 按项目维护（`agentStatesByProject`），并通过 `updateAgentState` 持久化到 `agent_sessions` 表。
- `sendMessage` 执行前将状态置为 `working` 并写入 `current_task`；结束后置回 `idle`；异常置为 `error`；暂停/恢复写入 `paused/idle`。
- 进程初始化或首次访问项目时，`ensureProjectState` 会从 `agent_sessions` 恢复状态：
  - DB 中若是 `working`，会回正为 `idle`（避免重启后卡在“工作中”假状态）。
  - `paused` 会恢复为暂停态并写入 `pausedAgentsByProject`。
- `lastMessage` 属于内存态，当前不落库； 服务重启后该字段会丢失。 持久化主要覆盖 `status/current_task/sdk_session_id/updated_at`， 不影响可恢复状态（status/current_task/paused）和历史消息查询（`agent_messages`）。

#### 4) 项目切换与状态边界
- 前端项目切换通过 `api.switchProject(fromProjectId, toProjectId)` 调用 `/api/projects/switch`，该接口现在只做轻量上下文切换，不再驱动 Star Office Agent offline/online 同步。
- 指令中心当前 Agent 的“记忆”是前端 localStorage 行为（按项目键隔离），不是服务端 `/api/projects/switch` 写库行为。
- Agent 运行状态与消息历史的服务端隔离依赖 `project_id`（`agent_sessions`、`agent_messages`、`logs` 等）。

### 测试策略

- **单元测试**：集中于数据库函数与工具逻辑（目前较少，可补充）。
- **集成测试**：API 端点的输入输出验证（通过 Postman 或 Supertest）。
- **E2E 测试**：Playwright 模拟真实用户操作，覆盖全流程。
- **Mock 策略**：使用独立的 Mock Server 替代 SDK，确保测试稳定、快速。

### 部署与运行

- **开发模式**：`npm run dev` 同时启动前后端热重载。
- **生产构建**：`npm run build` 生成前端静态文件，`npm run build:server` 编译后端。
- **Docker 编排**：`docker‑compose up --build -d` 一键启动完整服务。
- **UI 测试**：`docker compose ui test` 运行完整的 E2E 测试套件。

### 技术亮点

1. **项目级隔离**：数据库、Agent 状态、工具调用均按项目 ID 隔离，支持多团队并行。
2. **实时同步**：SSE + 事件驱动确保 UI 与后端状态实时一致。
3. **工具自动化**：通过 MCP Server 将自定义工具无缝集成到 SDK，Agent 可直接调用。
4. **自动交接**：autopilot 模式实现任务自动流转，减少人工干预。
5. **完整测试覆盖**：UI E2E 测试模拟真实用户行为，保障核心流程质量。
6. **国际化**：中英双语 UI，便于不同地区团队使用。
7. **Star‑Office‑UI 集成**：与腾讯内部办公平台深度联动，提升协作效率。
