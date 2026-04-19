# SDK Mock Server 架构

## 系统提示词结构
- SDK 的 `/chat/completions` 请求中 **system message 在 `messages[0]`**（role=system）
- system prompt 用 `contentPreview` 字段传递（非 `content`），值是普通字符串
- **所有 Agent 的 systemPrompt 以 `${LANGUAGE_ADAPTATION}` 前缀开头**
  - 约 200+ 字符的空白前缀后才出现角色关键词
  - 示例：`## 语言适配规则（必须遵守）\n\n` + 空白 + `你是游戏开发团队的 CEO`
- 角色关键词位置：游戏策划(game_designer)、软件工程师(engineer)、架构师(architect)、CEO(ceo)、商业策划(biz_designer)

## MCP 工具执行机制
- **MCP 工具执行是进程内通信**：Mock Server 只负责模拟 LLM `/chat/completions` 响应返回 tool_calls
- 工具实际执行由 Studio Backend 内部的 `createSdkMcpServer()` 处理
- Mock Server 上的 `/mcp/servers` 和 `/mcp/servers/{id}/tools` 端点是死代码（SDK 不调用它们）

## Agent 角色检测
- 6 个 Agent 必须全部加入检测：game_designer, architect, engineer, biz_designer, ceo, team_builder
- **特别注意**：team_builder 请求容易被误认为 CEO——必须单独检测"团队建设"/"Team Building"关键字
- team_builder 的 systemPrompt 包含"团队建设"或"Team Building"关键字
- team_builder 的 handoffTargets 为空数组（不做交接）

## SSE Streaming 要求
- Mock Server 返回 SSE stream 时，tool_calls 必须拆成多个 chunk 发送
- 每个 tool_call 一个独立 chunk（包含 `index`、`function.name`、`function.arguments`）
- 最后一个 chunk 必须包含 `finish_reason: 'tool_calls'`
- 不可在单个 chunk 中发送完整 tool_calls，否则 CLI 无法正确解析

## LANGUAGE_ADAPTATION 前缀内容
- 位于 `server/agents.ts` 的 `LANGUAGE_ADAPTATION` 常量
- 包含语言适配规则，要求 Agent 跟随用户指令语言回复
