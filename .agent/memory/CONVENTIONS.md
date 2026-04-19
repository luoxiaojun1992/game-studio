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
- 状态在 `StudioPage.commandTargetAgent`（跨面板目标）与 `CommandPanel.selectedAgent`（面板内选中）之间双向同步
- localStorage key 格式: `commandPanel_lastAgent_${projectId}`
- 切换项目时会按项目键自动恢复保存的 Agent；无效值会回退到可指令 Agent 默认值
- `team_builder` 会被过滤，不作为指令中心可选目标 Agent
- 关键实现位置：`src/pages/StudioPage.tsx`、`src/components/CommandPanel.tsx`
- 同步方向说明：
  - `StudioPage -> CommandPanel`：从总览卡片“发送指令”跳转或项目切换恢复时，通过 `selectedAgentId` 驱动 CommandPanel 切换并写回 localStorage。
  - `CommandPanel -> StudioPage`：用户在指令中心左侧切换 Agent 时，通过 `onAgentChange` 回传更新 `commandTargetAgent`。
  - 冲突处理：以“最后一次用户触发的切换”生效；项目切换时会先按新项目 localStorage 重置目标 Agent。

## 交接默认行为
- `auto_handoff_enabled` 表默认值应为 1（交接无需人工确认，自动放行）

## 工程师任务同步规则
- 工程师同时持有"开发"和"测试"两种任务状态，两者必须同步更新
- systemPrompt 中有强制规则要求双任务状态同步

## project_id 架构原则
- LLM 不会主动输出 `project_id` 参数，所有工具必须内部自行获取
- `createStudioToolsServer(projectId, ...)` 在创建时注入 `scopedProjectId`
- 工具内部直接使用 scopedProjectId，不接收外部 project_id 参数
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
| mock `submit_game` 不传 project_id | 通过 setMockExpectation 的 projectId 参数隐式传递（工具内部自动使用 scopedProjectId） | 避免 game 写入 default 项目导致 SSE channel 不匹配 |
| 用 class/文本选择器定位 DOM 元素 | 统一使用 `data-testid` 属性 + `getByTestId()` | DOM 结构变化不断言 |
| 逐步等待固定时间（waitForTimeout 链式调用） | 目标状态驱动的事件循环 + 非阻塞轮询 | 测试更稳定、更快 |
| UI-007/008 各写独立测试逻辑 | 抽取 `runFullWorkflowTest()` 共享函数 + WorkflowOptions 参数化 | 消除重复代码，降低维护成本 |
| 手动模式下在循环外 accept/confirm | 循环体内每轮尝试 tryAcceptAnyPending + tryConfirmAnyAccepted | 适应异步事件到达时序不确定性 |

## Lint Framework 约定
- **新增检查器必须实现 `LintChecker` 接口**，注册到 `checkers/index.ts` 的 `builtInCheckers` 数组
- **error = 阻断提交**，**warn = 仅记录日志**，不设 info 级别
- **checker 内部异常由 LintRunner catch 并降级为 error issue**，不会中断其他 checker 执行
- **submit_game 是唯一调用点**（tools.ts 权限校验后、db.createGame() 前），API 层和 DB 层不接入 lint
- **零外部依赖**：检查器使用纯正则/字符串分析，不引入 DOM parser 或 AST 库
