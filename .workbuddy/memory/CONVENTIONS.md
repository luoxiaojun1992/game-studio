# 项目约定与 Bug 修复

## ⚠️ 工作红线
- **永远禁止 workaround！** 任何修改必须基于正确的根因分析，逻辑正确是底线
- 不允许为了"让测试通过"而放宽断言、加 fallback、或绕过正常流程
- 遇到问题必须先定位根因，再修复，不能猜测或碰运气

## Agent 选择状态持久化
- 状态集中管理：`StudioPage.commandTargetAgent` 作为单一数据源
- localStorage key 格式: `commandPanel_lastAgent_${projectId}`
- 切换项目时自动加载对应项目的保存 Agent
- 两个修改点: `StudioPage.tsx`（`getCommandAgentKey()`）+ `CommandPanel.tsx`（`onAgentChange` 回调）

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
