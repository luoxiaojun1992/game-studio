# 可复用代码片段、代码模板与设计模式

## 适用范围
- 本文聚焦可跨模块复用的实现方式，优先记录后端工具层、API 层、前端状态层、E2E 测试层的稳定模式。
- 每条都给出对应源码入口，便于直接复用或按需裁剪。

## 一、可复用代码片段（Snippets）

### 1) 文本与标题标准化校验片段
- 参考位置：`server/db.ts`
- 关键函数：`normalizeAndValidateRequiredText`、`normalizeOptionalText`、`normalizeAndValidateTitle`
- 复用价值：统一“去空白 + 非空校验 + 单行约束 + 枚举约束”，避免各层重复写字符串校验。

### 2) Project ID 归一化与验证片段
- 参考位置：`server/index.ts`、`server/agent-manager.ts`
- 关键函数：`normalizeProjectId`、`validateProjectIdInput`
- 复用价值：统一 project 作用域边界，保证所有接口在非法输入时安全回落到默认项目或明确报错。

### 3) Tool 参数 schema 复用片段
- 参考位置：`server/tools.ts`
- 关键片段：`singleLineTitleSchema(fieldName)`、`requiredTextSchema(fieldName)`
- 复用价值：通过 zod transform 复用 DB 校验逻辑，减少工具参数定义中的重复代码。

### 4) Agent 权限门禁片段
- 参考位置：`server/tools.ts`
- 关键片段：`validateAgentPermission(allowed, action)`
- 复用价值：为工具写操作建立统一角色授权入口，避免权限散落在业务逻辑内部。

### 5) 任务状态流转约束片段
- 参考位置：`server/tools.ts`
- 关键片段：`TASK_STATUS_FLOW` + 合法流转检查
- 复用价值：可直接复用于任何任务状态机场景，保证状态变更可解释、可追踪。

### 6) SSE 广播片段（按项目隔离）
- 参考位置：`server/sse-broadcaster.ts`
- 关键片段：`clientsByProject`、`broadcast(event, projectId?)`
- 复用价值：复用“按租户/项目分组的订阅广播”能力，支持局部广播与全局广播两种模式。

### 7) SSE 初始化快照 + 增量事件片段
- 参考位置：`server/index.ts` (`/api/observe`)
- 关键片段：首次 `init` 快照 + 心跳 + close 清理
- 复用价值：前端可一次性完成 hydration，再靠增量事件保持实时一致。

### 8) 工具结果摘要压缩片段
- 参考位置：`server/agent-manager.ts`
- 关键片段：`summarizeToolInput`、`summarizeToolResult`
- 复用价值：统一日志可读性策略，避免长输出污染 UI 时间线。

### 9) 统一 API 请求封装片段
- 参考位置：`src/config.ts`
- 关键片段：`api` 对象（按域分组、统一 fetch + URLSearchParams）
- 复用价值：前端请求入口单一，便于替换 base URL、增加认证头、做错误处理收敛。

### 10) 本地持久化选择状态片段
- 参考位置：`src/components/CommandPanel.tsx`、`src/pages/StudioPage.tsx`
- 关键片段：`commandPanel_lastAgent_${projectId}`
- 复用价值：同一模式可复用于“按项目隔离的 UI 偏好设置”。

## 二、可复用代码模板（Templates）

### 1) 后端 API Handler 模板
- 参考位置：`server/index.ts`（多条路由）
- 模板结构：
  1. 读取并 normalize 输入；
  2. validate（类型/枚举/必填）；
  3. 调用 db/manager；
  4. 必要时 `sseBroadcaster.broadcast(...)`；
  5. 返回标准 JSON（成功/错误）。
- 适用场景：新增 REST 接口时统一风格与错误语义。

### 2) MCP Tool 定义模板
- 参考位置：`server/tools.ts`
- 模板结构：
  1. `tool(name, description, zodSchema, async handler)`；
  2. handler 内做权限校验；
  3. 持久化写入；
  4. 广播事件与日志；
  5. 返回 `content: [{ type: 'text', text }]`。
- 适用场景：新增 Agent 可调用工具。

### 3) Agent 会话执行模板（sendMessage）
- 参考位置：`server/agent-manager.ts`
- 模板结构：
  1. 状态切换 idle→working；
  2. 组装 MCP server 与 canUseTool；
  3. 流式消费 query 输出；
  4. 落库消息/日志；
  5. 结束态收敛（idle/error/paused）。
- 适用场景：任何“长任务 + 工具调用 + 流式回传”执行器。

### 4) React SSE 订阅模板
- 参考位置：`src/pages/StudioPage.tsx`
- 模板结构：
  1. `EventSource` 建连；
  2. `onmessage` 分发事件；
  3. `onerror` 重连；
  4. cleanup 关闭连接。
- 适用场景：前端实时看板、日志流、运行态监控面板。

### 5) i18n Provider 模板
- 参考位置：`src/i18n.tsx`
- 模板结构：Context + localStorage + `l(zh,en)` 双语选择器。
- 适用场景：轻量级中英文切换且不引入额外 i18n 库。

### 6) E2E 工作流模板（目标状态驱动循环）
- 参考位置：`tests/ui/e2e/studio.spec.ts` (`runFullWorkflowTest`)
- 模板结构：
  1. 预置 mock 队列；
  2. 触发起始动作；
  3. 循环执行非阻塞步骤（权限、交接、计数）；
  4. 达到目标状态后集中断言；
  5. 超时失败并输出调试日志。
- 适用场景：异步链路长、状态收敛慢的端到端测试。

### 7) Mock Expectation 队列模板
- 参考位置：`tests/ui/e2e/studio.spec.ts`
- 模板结构：`setMockExpectation(projectId, agentRole, response)` + 便捷包装函数。
- 适用场景：按角色路由的可重复测试编排。

## 三、可复用设计模式（Design Patterns）

### 1) 工厂模式（Factory）
- 参考位置：`createStudioToolsServer(...)`（`server/tools.ts`）
- 说明：按 `projectId + agentId` 动态生产专属 MCP 工具实例，实现作用域注入与隔离。

### 2) 策略/插件模式（Strategy / Plugin）
- 参考位置：`server/lint/`（`LintChecker` + `LintRunner.registerAll`）
- 说明：检查器按接口插件化，新增规则只需实现接口并注册，不改主流程。

### 3) 观察者模式（Observer / Pub-Sub）
- 参考位置：`server/agent-manager.ts` + `server/index.ts` + `server/sse-broadcaster.ts`
- 说明：`AgentManager` 产生活动事件，`index.ts` 订阅后转发到 SSE 与 StarOffice 同步。

### 4) 状态机模式（State Machine）
- 参考位置：`TASK_STATUS_FLOW`（`server/tools.ts`）、handoff 状态流转（`server/index.ts`）
- 说明：通过显式合法迁移表限制状态变化，防止非法跳转。

### 5) 仓储/数据访问封装（Repository-like）
- 参考位置：`server/db.ts`
- 说明：将 SQL 与业务层解耦为函数接口（create/update/get），上层只操作领域对象。

### 6) 适配器模式（Adapter）
- 参考位置：`server/star-office-sync.ts`
- 说明：把内部 Agent 状态映射并推送到外部 Star-Office 协议，屏蔽上下游模型差异。

### 7) 模板方法风格（Template Method）
- 参考位置：`runFullWorkflowTest`（`tests/ui/e2e/studio.spec.ts`）
- 说明：固定测试骨架，参数化差异（`autopilot`、`gameName`、`testId`）。

## 四、推荐复用顺序

1. 优先复用现有校验函数（`server/db.ts`）与 schema 片段（`server/tools.ts`）。
2. 新增后端写操作时，沿用“写库 + broadcast + log”三联模板。
3. 前端实时页面优先套用 `StudioPage` 的 SSE 模板，而非手写轮询。
4. 新增 E2E 长流程优先使用 `runFullWorkflowTest` 式目标状态循环，而非固定 sleep 链。
