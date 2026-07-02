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
| [LINT.md](./LINT.md) | Lint Framework 架构、LintRunner、双检查器（SonarQube + GameEngineering）、20 条规则总览、扩展指南 |
| [REUSABLE_PATTERNS.md](./REUSABLE_PATTERNS.md) | 可复用代码片段、代码模板、设计模式汇总 |
| [GRAPHIFY.md](./GRAPHIFY.md) | Graphify 知识图谱技能使用指南 |
| [../skills/architecture-diagram/SKILL.md](../skills/architecture-diagram/SKILL.md) | architecture-diagram 技能：SVG 架构图维护、文字居中算法 |
| [../skills/doc-sync/SKILL.md](../skills/doc-sync/SKILL.md) | doc-sync 技能：文档同步检查清单（A→G 区域遍历、变更影响矩阵） |
| [../skills/graphify/SKILL.md](../skills/graphify/SKILL.md) | graphify 技能：知识图谱构建与查询（含 --code-only 模式） |
| [../skills/spec-writer/SKILL.md](../skills/spec-writer/SKILL.md) | spec-writer 技能：标准化 spec 设计文档编写规范 |
| [../../specs/github-ci-agent.md](../../specs/github-ci-agent.md) | SPEC-014: GitHub Actions CI Agent 调试规范 |
| [../../specs/opentelemetry-tracing/opentelemetry-tracing.md](../../specs/opentelemetry-tracing/opentelemetry-tracing.md) | SPEC-020: OpenTelemetry 分布式链路追踪（Jaeger、手动 Span、跨服务 trace 传播） |

## 快速参考

### 核心架构
- **graphify 知识图谱**：`graphify-out/graph.json` 预构建，1998 节点、3932 边、171 社区。通过 `/graphify query "<问题>"` 快速理解架构关系，`/graphify path "A" "B"` 查找最短路径。`--code-only` 模式可跳过 doc/image 语义提取（无需 API key）。
- 工具 schema 已移除 `project_id` 入参，项目作用域由后端注入 `scopedProjectId` 并在工具内部统一生效
- MCP 工具执行是进程内通信，Mock Server 只返回 tool_calls
- 6 个 Agent 中 team_builder 需特别检测（易与 CEO 混淆）
- `submit_game` 仅支持文件目录模式；engineer 先通过 MCP 工具 `write_game_file` 写入 HTML，再调 submit_game 打包 ZIP 上传 MinIO
- Lint 内置检查器：SonarQube（从 submitDir 自行打包 ZIP） + GameEngineeringChecker（20 条规则：8 公共 + 6 H5 + 6 phaser-mobile，直接读 submitDir/dist/* 文件）
- `game_engineering_specs` 表存储公共/H5/phaser-mobile 游戏工程规范，通过 `get_game_types`/`get_game_framework_spec`/`get_common_spec` 工具查询
- `games` 表已移除 `author_agent_id`，提交/查询链路不再输出该字段
- `logs`、`commands`、`permission_requests` 持久化字段统一包含 `updated_at`
- 新增 `get_games`（列表）与 `get_game_info`（详情）用于按项目查询游戏；文件模式详情返回 MinIO 预签名下载链接
- Blender 建模工具（`blender_*`）通过 `creator-service.ts` 调用 creator 微服务，模型文件下载/删除带安全路径校验
- 图片处理工具（`image_*`）通过 `image-service.ts` 调用 image 微服务。`image_write_file`（本地 base64→Buffer）+ `image_upload_file`（本地→POST 微服务）职责分离。微服务侧 `IMAGE_SERVICE_TEST_MODE` 生成固定 project_id
- 视频处理工具（`video_*`）通过 `video-service.ts` 调用 video 微服务。`video_write_file`（本地 base64→Buffer）+ `video_upload_file`（本地→POST 微服务）职责分离。微服务侧 `VIDEO_SERVICE_TEST_MODE` 生成固定 project_id `vid-proj-001`
- 构建打包工具（`build_*`）通过 `build-service.ts` 调用 build 微服务（Node.js 22 + FastAPI，端口 8085）。共 9 个工具：project CRUD、源码上传、构建触发、状态查询、文件管理。`BUILD_SERVICE_TEST_MODE` 返回固定 `build-proj-001`。submit_game 集成自动构建，失败时 fallback
- draw.io 图表工具（`drawio_*`、`drawio_list_elements`）通过 `drawio-service.ts` 调用微服务，项目记录存放于 `drawio_projects`
- 策划案附件记录在 `proposal_attachments`，附件文件存储在 MinIO
- SonarQube 报告上传后写入 `games.sonar_storage_id`，前端可下载扫描报告
- `proposals` 表含 `source` 字段（`manual`/`questionnaire`），问卷式提案通过 `questionnaire-renderer.ts` 渲染结构化输入为 Markdown
- `QuestionnaireForm` 组件提供分步问卷表单，`GET /api/game-types` 动态获取游戏工程类型
- Jaeger 分布式追踪（SPEC-020）：`jaegertracing/all-in-one` 容器，103686 UI；手动 Span 覆盖 `agent.run`/`agent.think`/`agent.tool_call`；W3C TraceContext 跨服务传播
- `POST /api/proposals/questionnaire` 为问卷提案 REST 入口，提交后与普通提案完全等价

### E2E 测试关键
- 选择器不匹配 → 前端加 `data-testid` → 测试用属性选
- gameCount=0/工具失败高频根因：mock 的 `toolCalls.arguments` 与当前 zod schema 不一致（如继续传 `project_id` 或缺必填字段）
- SSE reconnect bug：`connectedRef.current` 阻止重连

### 工作红线
- **禁止 workaround**，必须基于根因修复
