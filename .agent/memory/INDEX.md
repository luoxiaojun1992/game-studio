# Game Dev Studio - 工作记忆索引

> 本文件是主索引，各个维度的经验已拆分到专用文档中。

## 文档索引

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 项目架构、关键文件、SDK Tools、MCP 机制、SonarQube 集成、Game Engineering Framework |
| [E2E_TESTING.md](./E2E_TESTING.md) | E2E 测试选择器原则、UI-007/008 调试经验、Docker |
| [SDK_MOCK.md](./SDK_MOCK.md) | Mock Server 架构、Agent systemPrompt、LANGUAGE_ADAPTATION |
| [STAROFFICE.md](./STAROFFICE.md) | Star-Office-UI 集成、状态映射 |
| [CONVENTIONS.md](./CONVENTIONS.md) | 工作红线、Bug 修复记录、Agent 状态持久化、SonarQube 踩坑 |
| [LINT.md](./LINT.md) | Lint Framework 架构、LintRunner、双检查器（SonarQube + GameEngineering）、14 条规则总览、扩展指南 |
| [REUSABLE_PATTERNS.md](./REUSABLE_PATTERNS.md) | 可复用代码片段、代码模板、设计模式汇总 |

## 快速参考

### 核心架构
- 工具 schema 已移除 `project_id` 入参，项目作用域由后端注入 `scopedProjectId` 并在工具内部统一生效
- MCP 工具执行是进程内通信，Mock Server 只返回 tool_calls
- 6 个 Agent 中 team_builder 需特别检测（易与 CEO 混淆）
- `submit_game` 仅支持文件目录模式；engineer 先通过 MCP 工具 `write_game_file` 写入 HTML，再调 submit_game 打包 ZIP 上传 MinIO
- Lint 内置检查器：SonarQube（从 submitDir 自行打包 ZIP） + GameEngineeringChecker（14 条规则，直接读 submitDir/dist/* 文件）
- `game_engineering_specs` 表存储公共/H5 游戏工程规范，通过 `get_game_types`/`get_game_framework_spec`/`get_common_spec` 工具查询
- `games` 表已移除 `author_agent_id`，提交/查询链路不再输出该字段
- `logs`、`commands`、`permission_requests` 持久化字段统一包含 `updated_at`
- 新增 `get_games`（列表）与 `get_game_info`（详情）用于按项目查询游戏；文件模式详情返回 MinIO 预签名下载链接
- Blender 建模工具（`blender_*`）通过 `creator-service.ts` 调用 creator 微服务，模型文件下载/删除带安全路径校验
- draw.io 图表工具（`drawio_*`、`drawio_list_elements`）通过 `drawio-service.ts` 调用微服务，项目记录存放于 `drawio_projects`
- 策划案附件记录在 `proposal_attachments`，附件文件存储在 MinIO
- SonarQube 报告上传后写入 `games.sonar_storage_id`，前端可下载扫描报告

### E2E 测试关键
- 选择器不匹配 → 前端加 `data-testid` → 测试用属性选
- gameCount=0/工具失败高频根因：mock 的 `toolCalls.arguments` 与当前 zod schema 不一致（如继续传 `project_id` 或缺必填字段）
- SSE reconnect bug：`connectedRef.current` 阻止重连

### 工作红线
- **禁止 workaround**，必须基于根因修复
