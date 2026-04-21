# Game Dev Studio - 工作记忆索引

> 本文件是主索引，各个维度的经验已拆分到专用文档中。

## 文档索引

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 项目架构、关键文件、SDK Tools、MCP 机制 |
| [E2E_TESTING.md](./E2E_TESTING.md) | E2E 测试选择器原则、UI-007/008 调试经验、Docker |
| [SDK_MOCK.md](./SDK_MOCK.md) | Mock Server 架构、Agent systemPrompt、LANGUAGE_ADAPTATION |
| [STAROFFICE.md](./STAROFFICE.md) | Star-Office-UI 集成、状态映射 |
| [CONVENTIONS.md](./CONVENTIONS.md) | 工作红线、Bug 修复记录、Agent 状态持久化 |
| [LINT.md](./LINT.md) | 可扩展 Lint Framework 架构、LintRunner、内置检查器、扩展指南 |
| [REUSABLE_PATTERNS.md](./REUSABLE_PATTERNS.md) | 可复用代码片段、代码模板、设计模式汇总 |

## 快速参考

### 核心架构
- 所有工具调用必须显式传 `project_id`，并与会话作用域 `scopedProjectId` 一致
- MCP 工具执行是进程内通信，Mock Server 只返回 tool_calls
- 6 个 Agent 中 team_builder 需特别检测（易与 CEO 混淆）
- `submit_game` 支持 HTML 与文件打包双模式；文件模式会上传 MinIO 并回写 `file_storage_id`
- 新增 `get_games`（列表）与 `get_game_info`（详情）用于按项目查询游戏；文件模式详情返回 MinIO 预签名下载链接

### E2E 测试关键
- 选择器不匹配 → 前端加 `data-testid` → 测试用属性选
- gameCount=0/工具失败高频根因：mock 缺失或传错 `project_id`，被 zod/作用域校验拒绝
- SSE reconnect bug：`connectedRef.current` 阻止重连

### 工作红线
- **禁止 workaround**，必须基于根因修复
