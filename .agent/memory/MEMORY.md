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
- **2026-06-07**: 实现 SPEC-014 GitHub Actions CI Agent 调试规范。确立 PAT 凭证方案：`GITHUB_PAT` 环境变量（推荐） + `.github-pat` 本地文件（备选）。调试循环参数：10 次上限、60s 轮询间隔、45min 单次 run 超时。agent 通过 `gh` CLI（优先）或 `curl` + PAT 调用 GitHub REST API 查询 CI 状态、下载 job 日志和 artifact。不涉及 `server/` 目录代码变更，仅规范 coding agent 自身行为。
- **2026-06-07**: 实现 SPEC-008 ImageMagick 图片处理微服务。完整复制 creator service (Blender) 全链路模式：FastAPI 微服务 (`image-service/`) → TS 客户端 (`server/image-service.ts`) → 17 个 MCP 工具 (`ENGINEER_ALLOW`)。关键决策：alpine:3.21 + imagemagick + font-noto（~50MB 镜像）、端口 8089、healthcheck `curl -f`、12 个图片操作 + 5 个管理工具。UI test (UI-012)：在 `runFullWorkflowTest` 的 engineer 阶段新增 12 个 image mock 步骤（create → info → resize → compress → convert → watermark → composite → sprite_sheet → download ×2 → delete）。`install_binary` → `install_binary` 修正：Dockerfile 基于 `alpine:3.21`，Alpine 需 `font-noto` 包支持中文水印。
- **2026-04-02**: 修复 6 个 Bug（历史记录丢失、产出持久化失败等），确立 project_id 作用域隔离原则
- **2026-04-18**: E2E 9/9 全通过，完成三层架构一致性审查；确立事件循环测试模式为 UI-007/008 共享标准模式
- **2026-04-18**: 新增 UI-009 提案创建测试，补全 E2E 测试与 data-testid 对照文档
- **2026-04-18**: 实现可扩展 Lint Framework（注册式架构，LintRunner + 可插拔 checker），第一期实现 HTML 结构 + JS 安全两个检查器，集成到 submit_game tool 拦截点
- **2026-05-28**: 实现 SPEC-007 问卷式提案提交：`proposals.source` 字段、`questionnaire-renderer.ts` 渲染引擎、`GET /api/game-types` + `POST /api/proposals/questionnaire` API、`QuestionnaireForm` 分步表单组件、UI-010 E2E 测试。确立主动更新所有文档规范。

> **提示**: 查阅具体经验前先看 INDEX.md 快速定位。
