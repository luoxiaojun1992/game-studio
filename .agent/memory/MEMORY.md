# Game Dev Studio - 长期记忆

**主索引**: [INDEX.md](./INDEX.md)

详细文档：
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 项目架构（含 E2E Docker 服务依赖图、data-testid 架构）
- [E2E_TESTING.md](./E2E_TESTING.md) — E2E 测试经验（事件循环架构、9 用例矩阵、21 个 testid 对照表）
- [SDK_MOCK.md](./SDK_MOCK.md) — Mock Server + Agent 架构
- [STAROFFICE.md](./STAROFFICE.md) — Star-Office-UI 集成
- [CONVENTIONS.md](./CONVENTIONS.md) — 工作约定、Bug 修复、被纠正的错误做法汇总表
- [LINT.md](./LINT.md) — 可扩展 Lint Framework（LintRunner 注册式架构、HTML+JS 检查器、扩展指南）
- [REUSABLE_PATTERNS.md](./REUSABLE_PATTERNS.md) — 可复用代码片段、代码模板、设计模式汇总

## 关键工程决策记录
- **2026-06-17**: 实现 SPEC-017 Tool Search（元数据驱动的工具发现）。核心改造：将 `server/tools.ts` 中 79 个 tool 的元数据（name/description/inputSchema）从 inline `tool()` 调用中分离，提取为模块级 `TOOL_META_DEFINITIONS` 数组（80 个条目，含新增 `search_tools`）。

  **关键架构决策**：
  - `ToolMeta` 接口包含 `name`/`description`/`inputSchema`，不含 handler
  - `AGENT_ID_ENUM` 从 `createStudioToolsServer()` 内部提至模块级
  - `get_game_framework_spec` schema 从 IIFE `z.enum()` 降为 `z.string()`（避免模块加载时依赖 DB）
  - `get_game_types` 新增可选 `limit` 参数（对齐其他 listing tool 的分页模式）
  - `createStudioToolsServer()` 内部用 `TOOL_META_DEFINITIONS.map()` + `handlers` Record 组装 tool，替代原 inline 方式
  - `agent-manager.ts` 的 `STUDIO_TOOL_NAMES` set 改为从 `TOOL_META_DEFINITIONS` 自动派生（`TOOL_META_DEFINITIONS.map(m => m.name)`），消除 3 处手动维护的重复
  - `search_tools` 自身也在 `TOOL_META_DEFINITIONS` 中，搜索 `"search"` 会返回自身
  - `db.getGameTypes()` 新增可选 `limit` 参数，使用条件 SQL（`LIMIT ?`）而非默认全量

  **文件变更**：
  - `server/tools.ts`: 核心重构（+ToolMeta, +TOOL_META_DEFINITIONS, +search_tools, handlers Record）
  - `server/db.ts`: `getGameTypes(limit?)` (+5行)
  - `server/agent-manager.ts`: `STUDIO_TOOL_NAMES` 自动派生 (-60行/+1行)
  - 无新增微服务、无新增 Docker 容器、无新增 DB 表、无前端 UI 变更

- **2026-06-13**: 设计 SPEC-020 OpenTelemetry 分布式链路追踪。使用 Jaeger all-in-one 作为追踪后端（端口 16686），集成到 `docker-compose.yml` 和 `docker-compose.ui-test.yml`（`docker-compose-sonar-check.yml` 不添加 — SonarQube 自有扫描报告）。

  **关键架构决策**：
  - Node.js Express backend：`@opentelemetry/sdk-node` + `auto-instrumentations-node`，`server/telemetry.ts` 初始化（在所有其他模块之前）
  - Python FastAPI 微服务（creator/image/drawio/scanner/video）：OTel Python SDK + `FastAPIInstrumentor`
  - 跨服务 Trace 传播：W3C TraceContext（`traceparent` header），HTTP 自动携带
  - 手动 Span（`agent.run` / `agent.think` / `agent.tool_call`）+ Span Event（`sse.broadcast`）
  - `agent.tool_call` 跨越 SDK 的两个独立消息（`tool_use` + `tool_result`），需用 `Map<toolUseId, Span>` 暂存
  - Fail-open 策略：OTel SDK 或 Jaeger 不可达时业务逻辑不受影响
  - 创建 `svg-to-png` skill（`rsvg-convert` 转 PNG），置于 `.workbuddy/skills/` 和 `.agent/skills/`

  **文件组织**：spec 和图片归入 `.agent/specs/opentelemetry-tracing/` 目录。
- **2026-06-11**: 集成 Graphify 知识图谱（v0.8.37）。Skill 安装于 `.agent/skills/graphify/`，预构建图谱保存于 `graphify-out/`（1697 节点、2952 边、149 社区）。`.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` 新增 Skills 章节和 GRAPHIFY.md 引用。`.agent/` 目录确立为 agent 上下文首选来源——所有 agent 启动时应先读取 `.agent/` 下文档了解项目全貌。
- **2026-06-07**: 实现 SPEC-014 GitHub Actions CI Agent 调试规范。确立 PAT 凭证方案：`GITHUB_PAT` 环境变量（推荐） + `.github-pat` 本地文件（备选）。调试循环参数：10 次上限、60s 轮询间隔、45min 单次 run 超时。agent 通过 `gh` CLI（优先）或 `curl` + PAT 调用 GitHub REST API 查询 CI 状态、下载 job 日志和 artifact。不涉及 `server/` 目录代码变更，仅规范 coding agent 自身行为。
- **2026-06-08**: 实现 SPEC-008 ImageMagick 图片处理微服务。完整复制 creator (Blender) 全链路模式：FastAPI 微服务 (`image-service/`) → TS 客户端 (`server/image-service.ts`) → 19 个 MCP 工具 (`ENGINEER_ALLOW`)。

  **关键架构决策**：
  - `image_write_file`（本地 base64→Buffer）+ `image_upload_file`（本地→POST 微服务）职责分离，与 `write_game_file` 模式一致
  - **微服务内部生成 project_id**（`POST /api/projects` 无 path param），不接收外部传入的 ID
  - **TEST_MODE toggle 在微服务侧**：`IMAGE_SERVICE_TEST_MODE=true` → 微服务返回固定 `img-proj-001`，studio backend 不感知
  - 同模式覆盖全部 7 个有 project 管理的微服务（creator/image/drawio/video/build/run/test），scanner 无 DB project 表不需要
  - Dockerfile: alpine:3.21 + imagemagick + `libwebp`（WebP 编码器）+ font-noto（基础字体），~50MB
  - 端口 8089，healthcheck `curl -f`

  **踩坑记录**：
  - Alpine `imagemagick` 包默认不含 WebP 编码器，需额外安装 `libwebp`，否则 `convert(PNG→WebP)` 返回 422
  - Alpine `font-noto` 不提供 `Noto-Sans-CJK-SC` 字体名，移除 `-font` 参数让 ImageMagick 用默认字体
  - mock 链路顺序：`image_info` 必须在 `image_resize` 之后，因为查询的图片是 resize 输出
  - 微服务 `print()` 的 `flush=True` 与 scanner 等 service 一致

  **UI test (UI-012)**：engineer 阶段新增 19 个 mock 步骤（create + write×4 + upload×4 + resize/info/compress/convert/watermark/composite/sprite-sheet + download×2 + delete），全部通过。
  - Specless services 也有对应的 spec docs (SPEC-015 Creator, SPEC-016 Drawio)
- **2026-04-02**: 修复 6 个 Bug（历史记录丢失、产出持久化失败等），确立 project_id 作用域隔离原则
- **2026-04-18**: E2E 9/9 全通过，完成三层架构一致性审查；确立事件循环测试模式为 UI-007/008 共享标准模式
- **2026-04-18**: 新增 UI-009 提案创建测试，补全 E2E 测试与 data-testid 对照文档
- **2026-04-18**: 实现可扩展 Lint Framework（注册式架构，LintRunner + 可插拔 checker），第一期实现 HTML 结构 + JS 安全两个检查器，集成到 submit_game tool 拦截点
- **2026-05-28**: 实现 SPEC-007 问卷式提案提交：`proposals.source` 字段、`questionnaire-renderer.ts` 渲染引擎、`GET /api/game-types` + `POST /api/proposals/questionnaire` API、`QuestionnaireForm` 分步表单组件、UI-010 E2E 测试。确立主动更新所有文档规范。

> **提示**: 查阅具体经验前先看 INDEX.md 快速定位。
- **2026-06-15**: 架构图全面改造。重绘 `docs/images/architecture.svg` 为四层中文 SVG（前端→后端→微服务→数据/外部），开发 `center_text.py` 文字居中算法（视觉边界：ascender 85%/descender 15%），修复容器 padding 截断问题（容器 h 必须 > 子框 y+h，留 ≥10px）。清理冗余的 `.workbuddy/skills/svg-to-png` 修改（仅保留原有 convert.py）。创建英文版 `architecture-en.svg` + `translate_svg.py` 翻译脚本。技能归档至 `.agent/skills/architecture-diagram/`（含 SKILL.md + center_text.py + translate_svg.py）。分支 `docs/readme-roadmap-update-20260615`。
