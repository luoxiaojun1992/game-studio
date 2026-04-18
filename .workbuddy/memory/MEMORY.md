# Game Dev Studio - 长期记忆

**主索引**: [INDEX.md](./INDEX.md)

详细文档：
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 项目架构（含 E2E Docker 服务依赖图、data-testid 架构）
- [E2E_TESTING.md](./E2E_TESTING.md) — E2E 测试经验（事件循环架构、9 用例矩阵、21 个 testid 对照表）
- [SDK_MOCK.md](./SDK_MOCK.md) — Mock Server + Agent 架构
- [STAROFFICE.md](./STAROFFICE.md) — Star-Office-UI 集成
- [CONVENTIONS.md](./CONVENTIONS.md) — 工作约定、Bug 修复、被纠正的错误做法汇总表
- [LINT.md](./LINT.md) — 可扩展 Lint Framework（LintRunner 注册式架构、HTML+JS 检查器、扩展指南）

## 关键工程决策记录
- **2026-04-02**: 修复 6 个 Bug（历史记录丢失、产出持久化失败等），确立 project_id 内部 scoped 原则
- **2026-04-18**: E2E 9/9 全通过，完成三层架构一致性审查；确立事件循环测试模式为 UI-007/008 共享标准模式
- **2026-04-18**: 新增 UI-009 提案创建测试，补全 E2E 测试与 data-testid 对照文档
- **2026-04-18**: 实现可扩展 Lint Framework（注册式架构，LintRunner + 可插拔 checker），第一期实现 HTML 结构 + JS 安全两个检查器，集成到 submit_game tool 拦截点
- **2026-04-18**: 新增 UI-009 提案创建测试，补全 E2E 测试与 data-testid 对照文档

> **提示**: 查阅具体经验前先看 INDEX.md 快速定位。
