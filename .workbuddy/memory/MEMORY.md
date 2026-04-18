# Game Dev Studio - 长期记忆

**主索引**: [INDEX.md](./INDEX.md)

详细文档：
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 项目架构（含 E2E Docker 服务依赖图、data-testid 架构）
- [E2E_TESTING.md](./E2E_TESTING.md) — E2E 测试经验（事件循环架构、9 用例矩阵、21 个 testid 对照表）
- [SDK_MOCK.md](./SDK_MOCK.md) — Mock Server + Agent 架构
- [STAROFFICE.md](./STAROFFICE.md) — Star-Office-UI 集成
- [CONVENTIONS.md](./CONVENTIONS.md) — 工作约定、Bug 修复、被纠正的错误做法汇总表

## 关键工程决策记录
- **2026-04-02**: 修复 6 个 Bug（历史记录丢失、产出持久化失败等），确立 project_id 内部 scoped 原则
- **2026-04-18**: 新增 UI-009 提案创建测试，补全 E2E 测试与 data-testid 对照文档
- **Docker proxy 规则**：host 端构建时带 proxy，容器运行时不传 proxy，`~/.docker/config.json` 用完必须清理 proxies 字段
- **Mock 数据契约**：测试 toolCalls.arguments 必须与 tools.ts zod schema 完全匹配，schema 变更后同步检查 mock 数据

> **提示**: 查阅具体经验前先看 INDEX.md 快速定位。
