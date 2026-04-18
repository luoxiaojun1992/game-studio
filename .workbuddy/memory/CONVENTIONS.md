# 项目约定与 Bug 修复

## ⚠️ 工作红线
- **永远禁止 workaround！** 任何修改必须基于正确的根因分析，逻辑正确是底线
- 不允许为了"让测试通过"而放宽断言、加 fallback、或绕过正常流程
- 遇到问题必须先定位根因，再修复，不能猜测或碰运气

## 6 个 Bug 修复记录 (2026-04-02)
1. CommandPanel 历史记录丢失
2. 产出持久化失败
3. 交接确认流程缺失
4. 清除聊天功能无效
5. 长期记忆未生效
6. 产出目录配置错误

## Agent 选择状态持久化
- 状态集中管理：`StudioPage.commandTargetAgent` 作为单一数据源
- localStorage key 格式: `commandPanel_lastAgent_${projectId}`
- 切换项目时自动加载对应项目的保存 Agent
- 两个修改点: `StudioPage.tsx`（`getCommandAgentKey()`）+ `CommandPanel.tsx`（`onAgentChange` 回调）

## project_id 架构原则
- LLM 不会主动输出 `project_id` 参数，所有工具必须内部自行获取
- `createStudioToolsServer(projectId, ...)` 在创建时注入 `scopedProjectId`
- 工具内部直接使用 scopedProjectId，不接收外部 project_id 参数
- 受影响工具: `split_dev_test_tasks`、`get_tasks`、`submit_proposal`、`submit_game`
- 与 `create_handoff`、`get_logs`、`get_proposals`、`get_pending_handoffs` 保持一致
- `enforceProject` 已成死代码，已删除

## Docker 构建代理规则
- **proxy 环境变量仅在 host 端使用**，用于 `docker compose up --build` 时的 npm install
- **不要将 proxy 变量传递给容器运行时**——容器内不需要代理访问其他容器服务
- 正确命令：`https_proxy=... http_proxy=... docker compose -f docker-compose.ui-test.yml up --build -d`
- `~/.docker/config.json` 的 `proxies` 字段会影响 Docker build context，用完必须清理

## Mock 数据契约对齐（测试 ↔ 工具层）
- 测试中 `setMockExpectation` 的 `toolCalls.arguments` 必须与 `tools.ts` 中 zod schema 完全匹配
- `submit_game` 的 `html_content` 有最小长度限制（`MIN_GAME_HTML_LENGTH`），mock 值必须足够长
- `submit_proposal` 的 `type` 必须是 `db.PROPOSAL_TYPES` 枚举值之一
- **经验**：工具 schema 变更后，同步检查测试 mock 数据，否则运行时报 zod 校验错误

## 被纠正的错误做法汇总

| 错误做法 | 正确做法 | 影响 |
|:---|:---|:---|
| 将 proxy 环境变量写入 docker-compose environment | 仅在 host 命令行传 proxy，容器不继承 | 避免容器内网络异常 |
| mock `submit_game` 不传 project_id | 通过 setMockExpectation 的 projectId 参数隐式传递（工具内部自动使用 scopedProjectId） | 避免 game 写入 default 项目导致 SSE channel 不匹配 |
| 用 class/文本选择器定位 DOM 元素 | 统一使用 `data-testid` 属性 + `getByTestId()` | DOM 结构变化不断言 |
| 逐步等待固定时间（waitForTimeout 链式调用） | 目标状态驱动的事件循环 + 非阻塞轮询 | 测试更稳定、更快 |
| UI-007/008 各写独立测试逻辑 | 抽取 `runFullWorkflowTest()` 共享函数 + WorkflowOptions 参数化 | 消除重复代码，降低维护成本 |
| 手动模式下在循环外 accept/confirm | 循环体内每轮尝试 tryAcceptAnyPending + tryConfirmAnyAccepted | 适应异步事件到达时序不确定性 |
