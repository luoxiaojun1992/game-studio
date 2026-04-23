# 项目约定与 Bug 修复

## ⚠️ 工作红线
- **永远禁止 workaround！** 任何修改必须基于正确的根因分析，逻辑正确是底线
- 不允许为了"让测试通过"而放宽断言、加 fallback、或绕过正常流程
- 遇到问题必须先定位根因，再修复，不能猜测或碰运气

## 6 个 Bug 修复记录
1. CommandPanel 历史记录丢失
2. 产出持久化失败
3. 交接确认流程缺失
4. 清除聊天功能无效
5. 长期记忆未生效
6. 产出目录配置错误

## Agent 选择状态持久化
- 状态在 `StudioPage.commandTargetAgent` 与 `CommandPanel.selectedAgent` 之间采用“双向协同（两条单向更新链路）”
- `StudioPage.commandTargetAgent` = 跨面板目标（页面级“全局当前指令目标 Agent”），用于总览卡片跳转到指令中心时透传
- `CommandPanel.selectedAgent` = 指令中心面板内当前选中 Agent
- localStorage key 格式: `commandPanel_lastAgent_${projectId}`
- 切换项目时会按项目键自动恢复保存的 Agent；无效值会回退到可指令 Agent 默认值
- `team_builder` 会被过滤，不作为指令中心可选目标 Agent（其职责是系统触发的总结/记忆沉淀）
- 关键实现位置：`src/pages/StudioPage.tsx`、`src/components/CommandPanel.tsx`
- 同步方向说明：
  - `StudioPage -> CommandPanel`：从总览卡片“发送指令”跳转或项目切换恢复时，通过 `selectedAgentId` 驱动 CommandPanel 同步并写回 localStorage。
  - `CommandPanel -> StudioPage`：用户在指令中心左侧切换 Agent 时，通过 `onAgentChange` 回传同步 `commandTargetAgent`。
  - 冲突处理：
    - 若两路几乎同时发生，最终以“最后一次状态写入”为准（React 状态 + localStorage 都遵循最后写入覆盖）
    - 项目切换属于更高优先级上下文切换，会先重载新项目存储并覆盖旧项目选择

## 交接默认行为
- `auto_handoff_enabled` 表默认值应为 1（交接无需人工确认，自动放行）

## 工程师任务同步规则
- 工程师同时持有"开发"和"测试"两种任务状态，两者必须同步更新
- systemPrompt 中有强制规则要求双任务状态同步

## project_id 架构原则
- 工具 schema 已移除 `project_id` 入参
- `createStudioToolsServer(projectId, ...)` 在创建时注入 `scopedProjectId`
- 工具运行时统一使用 `scopedProjectId`，拒绝跨项目访问
- 受影响工具: `split_dev_test_tasks`、`get_tasks`、`submit_proposal`、`submit_game`
- 与 `create_handoff`、`get_logs`、`get_proposals`、`get_pending_handoffs` 保持一致
- `enforceProject` 已成死代码，已删除

## Mock 数据契约对齐（测试 ↔ 工具层）
- 测试中 `setMockExpectation` 的 `toolCalls.arguments` 必须与 `tools.ts` 中 zod schema 完全匹配
- `submit_game` 的 `html_content` 有最小长度限制（`MIN_GAME_HTML_LENGTH`），mock 值必须足够长
- `submit_proposal` 的 `type` 必须是 `db.PROPOSAL_TYPES` 枚举值之一
- **经验**：工具 schema 变更后，同步检查测试 mock 数据，否则运行时报 zod 校验错误

## 被纠正的错误做法汇总

| 错误做法 | 正确做法 | 影响 |
|:---|:---|:---|
| 删除迁移代码前未确认 DDL 是否已包含所有必要列 | 删除迁移代码时必须审查 DDL（CREATE TABLE）是否已包含迁移所添加的全部列 | 迁移删了但 DDL 没列 → submit_game 等静默报错，数据无法持久化 |
| 推送前未 commit，直接 `git push -u origin branch` | 每次 push 前必须 `git status` 确认改动已 commit | 避免空分支 PR |
| mock 继续传已移除的 `project_id` 或漏传新必填参数 | 让 `toolCalls.arguments` 与当前 zod schema 严格一致（不要再传 `project_id`） | 避免参数校验失败导致工具不执行 |
| Docker 构建时基础镜像包名写错（如 `libxi-6` 而非 `libxi6`） | Ubuntu 24.04 包名无横杠，且部分包已更名（如 `libasound2` → `libasound2t64`）| 构建失败 |
| `uvicorn app.main:app` 启动时，用相对包名 `from schemas import` | 必须用完整包名 `from app.schemas import`，因为解释器工作目录是 `/app` 而非 `app/` 上级 | ModuleNotFoundError |
| 使用第三方 Blender Docker 镜像（`blenderai/blender` 等）| Blender 官方 `download.blender.org` 提供稳定公开二进制，用 `ubuntu:24.04 + 官方tarball` 自建更可控 | 镜像不存在或失联导致构建失败 |
| 逐步等待固定时间（waitForTimeout 链式调用） | 目标状态驱动的事件循环 + 非阻塞轮询 | 测试更稳定、更快 |
| UI-007/008 各写独立测试逻辑 | 抽取 `runFullWorkflowTest()` 共享函数 + WorkflowOptions 参数化 | 消除重复代码，降低维护成本 |
| 手动模式下在循环外 accept/confirm | 循环体内每轮尝试 tryAcceptAnyPending + tryConfirmAnyAccepted | 适应异步事件到达时序不确定性 |
| MCP server 采用按角色拆分的独立 server/工具集并行注册，导致非工程角色也暴露多余建模工具 | 使用单一 studio-tools server，但按角色选择性放行：`blender_*` 仅给 engineer | 降低非工程角色工具噪音，避免 handoff 流程与 mock 期望错乱 |
| 模型文件下载/删除直接拼接路径 | 下载/删除前必须做 safe path 校验（限制在 `output/{project_id}/models`） | 防止路径穿越导致越权读写 |
| 引入外部服务（如 SonarQube）后未配置 `depends_on` 和健康检查 | docker-compose 中新增有 API 依赖的服务（如 sonarqube），studio-backend 必须 `depends_on` 并设 `condition: service_healthy` | studio-backend 启动时依赖服务未就绪 → 认证/扫描请求直接失败 |
| SonarQube JDBC URL 格式写成 `postgresql://...` | 必须为 `jdbc:postgresql://...`，JDBC driver 要求 `jdbc:` 前缀 | 启动时 `Bad format of JDBC URL` 错误 |
| 新增 docker compose 服务未检查端口冲突 | 添加服务前先 `docker ps -a --format '{{.Ports}}'` 确认端口未被占用 | `Bind for 0.0.0.0:9000 failed: port is already allocated` |
| SonarQube 开发环境使用 PostgreSQL 外部依赖 | 开发/测试环境直接用 SonarQube 内置 H2 数据库，不挂 PostgreSQL | 减少运维复杂度，H2 对单实例够用 |
| health check 的 `start_period` 设置过短 | 新服务初始化时间可能很长（如 SonarQube H2 初始化需 120-300s），`start_period` 应设 300s 并配合 `retries` 重试 | `start_period` 不足导致 health check 直接失败，服务被标记 unhealthy |
| 遇到问题时先自己尝试而非查官方文档 | Docker/SonarQube 等开源软件的配置问题，官方文档和 GitHub issue 才是最准确的信息源 | 自己试错耗时且容易踩坑，官方文档一句话就能解决（如 SonarQube health check API 路径、`jdbc:` 前缀要求） |
| 新增 async 类型 checker 但未修改 LintRunner.run() 为 async | 若 checker.check() 返回 Promise，LintRunner.run() 必须改为 async 并用 `await` 等待结果 | 异步 checker 直接返回 Promise 但同步调用方拿不到正确结果 |
| ZIP 模式传给检查器前先解压再重压缩 | LintContext 新增 `zipBuffer?: Buffer` 字段，原生传递原始 Buffer 避免冗余压缩 | 浪费 CPU，且 SonarQbe 接收的是重新压缩后的包（与原始提交不符） |

## Session ↔ Project 关系
- **Session 不会跨 project**：每次 `sendMessage(projectId, agentId, ...)` 都会创建全新的 SDK session，session 与 project 一一对应
- `scopedProjectId` 在 `createStudioToolsServer` 注册时被闭包捕获是安全的，因为 session 不会跨越 project 边界
- 当前通过"每次 sendMessage 重新创建 server 实例"实现多 project 隔离，而非单实例多 project context 动态隔离
- 如果未来需要同一 session 内跨 project 操作，需要改用动态 project context 而非硬捕获 `scopedProjectId`

## Lint Framework 约定
- **新增检查器必须实现 `LintChecker` 接口**，注册到 `checkers/index.ts` 的 `builtInCheckers` 数组
- **error = 阻断提交**，**warn = 仅记录日志**，不设 info 级别
- **checker 内部异常由 LintRunner catch 并降级为 error issue**，不会中断其他 checker 执行
- **submit_game 是唯一调用点**（tools.ts 权限校验后、db.createGame() 前），API 层和 DB 层不接入 lint
- **零外部依赖**：检查器使用纯正则/字符串分析，不引入 DOM parser 或 AST 库
