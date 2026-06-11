# Session-End Handoff Auto-Check 可行性调研

> 调研日期：2026-06-10
> 调研人：小九
> 需求：每次 agent session 结束时，自动检查 agent 是否创建了 handoff（不限对象，商业策划 biz_designer 除外）。只调研不实现。

---

## 1. 背景：Handoff 系统全貌

### 1.1 Handoff 数据模型

Handoff 存储在 `game-dev-studio/data/studio.db` 的 SQLite `handoffs` 表中：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | UUID |
| `project_id` | TEXT | 所属项目 |
| `from_agent_id` | TEXT | 发起者 |
| `to_agent_id` | TEXT | 接收者（排除 `biz_designer`） |
| `title` | TEXT | 交接标题 |
| `status` | TEXT | pending/accepted/working/completed/rejected/cancelled |
| `priority` | TEXT | low/normal/high/urgent |
| `created_at` | TEXT | ISO 8601 时间戳 |
| `source_command_id` | TEXT | 关联的命令 ID |

### 1.2 Handoff 创建流程

```
Agent (via SDK) → MCP tool: create_handoff → studio-tools MCP Server
  → db.createHandoff() → SQLite INSERT
  → sseBroadcaster.broadcast('handoff_created')
  → (autopilot on) → agentManager.sendMessage(to_agent)
```

Transcript 中记录为 `function_call`，格式：
```json
{
  "type": "function_call",
  "name": "mcp__studio_tools__create_handoff",
  "arguments": "{\"to_agent_id\": \"engineer\", \"title\": \"...\", ...}"
}
```

### 1.3 当前 Session 结束时的已有行为

`agent-manager.ts` 中 `sendMessage()` 方法在 agent session 结束时已经执行：
1. `agent_done` SSE 事件 → 前端通知
2. `sendTeamBuilderSummaryRequest()` → 触发 team_builder agent 做总结（其中会调用 `get_project_latest_info` 查询 handoffs）

但 **没有显式的 handoff 合规检查**。

---

## 2. Hook 系统能力分析

CodeBuddy 提供了两层 Hook 系统：

### 2.1 CLI 级 Hooks（`~/.codebuddy/settings.json`）

| Hook 事件 | 触发时机 | 可阻止？ | 接收数据 |
|-----------|---------|---------|---------|
| `SessionEnd` | CodeBuddy 会话结束时 | ❌ 否 | session_id, transcript_path, reason |
| `Stop` | 主 Agent 响应结束时 | ✅ 是 | session_id, transcript_path, stop_hook_active |
| `PostToolUse` | 工具调用完成后 | ❌ 否 | tool_name, tool_input, tool_response |
| `SubagentStop` | 子 Agent 结束时 | ✅ 是 | session_id, transcript_path |

**关键发现**：
- `SessionEnd` hook 接收 `transcript_path`（指向 JSONL 对话记录）和 `cwd`（工作目录）
- 可以从 `cwd` 推导出 `studio.db` 路径
- 但 `SessionEnd` **不能阻止**会话结束，只能做**事后日志/通知**
- 输出仅在 `--debug` 模式下可见

### 2.2 SDK 级 Hooks（`@tencent-ai/agent-sdk`）

SDK 的 `query()` 函数支持 `hooks` 选项（类型定义在 `node_modules/@tencent-ai/agent-sdk/lib/types.d.ts`）：

```typescript
// HOOK_EVENTS 包含 SessionEnd
export declare const HOOK_EVENTS: readonly [
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification",
  "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop",
  "SubagentStart", "SubagentStop", "PreCompact", "PermissionRequest"
];

// SessionEnd 输入
export type SessionEndHookInput = BaseHookInput & {
    hook_event_name: 'SessionEnd';
    reason: 'user_exit' | 'interrupt' | 'error' | 'end_turn' | 'max_turns' | 'max_budget_usd';
};
```

**当前状态**：`agent-manager.ts` 的 `sendMessage()` 方法中，`query()` 调用 **没有配置 `hooks` 选项**。代码仅通过 `for await...of` 消费 stream 消息。

---

## 3. 四种可行方案

### 方案 A：SDK PostToolUse Hook — 实时检测 handoff 创建

**原理**：在 SDK `query()` 调用中添加 `PostToolUse` hook，匹配 `mcp__studio_tools__create_handoff`。

**实现位置**：`server/agent-manager.ts` 的 `sendMessage()` 方法，`_queryOpts.options` 中添加 `hooks`。

```typescript
hooks: {
  PostToolUse: [{
    matcher: 'mcp__studio_tools__create_handoff',
    hooks: [async (input) => {
      // input.tool_input.to_agent_id → 排除 biz_designer
      // 记录到内存计数器
      return { continue: true };
    }]
  }]
}
```

| 优点 | 缺点 |
|------|------|
| 实时检测，零延迟 | 只能检测创建事件，不能检测"是否创建了" |
| 可以直接获取 tool_input 参数 | 需要在内存中维护 session 状态 |
| 不需要解析 transcript | 只能检测 SDK-managed sessions |

**可行性**：✅ **高**

---

### 方案 B：SDK SessionEnd Hook — 会话结束时统一检查

**原理**：在 SDK `query()` 调用中添加 `SessionEnd` hook，在 agent 会话结束时查询 SQLite 数据库。

```typescript
hooks: {
  SessionEnd: [{
    hooks: [async (input, toolUseId, ctx) => {
      // 1. 获取 project_id（从 session context 或 transcript 推导）
      // 2. 查询 SQLite: SELECT COUNT(*) FROM handoffs 
      //    WHERE project_id = ? AND from_agent_id = ? 
      //    AND to_agent_id != 'biz_designer'
      // 3. 如果 count == 0 → 记录警告
      return { continue: true };
    }]
  }]
}
```

| 优点 | 缺点 |
|------|------|
| 天然的 "session 结束" 语义 | 需要从 hook 上下文获取 project_id 和 agent_id |
| 可以访问完整的数据库状态 | SessionEnd hook 不能阻止会话结束 |
| 逻辑集中在 hook 中 | 需要确保 DB 文件可访问 |

**可行性**：✅ **高**（需要解决 project_id/agent_id 传参问题）

---

### 方案 C：CLI SessionEnd Hook — 全局 session 级别检查

**原理**：在 `~/.codebuddy/settings.json` 或项目 `.codebuddy/settings.json` 中配置 `SessionEnd` hook。

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CODEBUDDY_PROJECT_DIR\"/.codebuddy/hooks/check-handoff.py"
          }
        ]
      }
    ]
  }
}
```

Hook 脚本从 stdin 接收：
```json
{
  "session_id": "...",
  "transcript_path": "/path/to/xxx.jsonl",
  "cwd": "/path/to/project",
  "permission_mode": "default",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

**两种检测路径**：

1. **解析 transcript**（JSONL）：grep `mcp__studio_tools__create_handoff`，解析 arguments JSON 中的 `to_agent_id`，排除 `biz_designer`
2. **查询 SQLite**：从 `cwd` 推导 `data/studio.db` 路径，直接查询 `handoffs` 表

| 优点 | 缺点 |
|------|------|
| 不需要修改 game-dev-studio 代码 | SessionEnd 不能阻止会话，只能做通知 |
| 对所有 CodeBuddy 会话生效 | 输出仅在 `--debug` 可见 |
| 配置简单，容易开关 | CLI hook 执行环境与 SDK 不同 |
| | 需要区分"当前 session"的 handoff vs 历史 handoff |

**可行性**：✅ **高**，但**反馈机制受限**（不能阻止、不能通知 Agent）

---

### 方案 D：扩展 agent-manager.ts 现有流程 — 最小改动

**原理**：在 `sendMessage()` 的 `result` 消息处理完成后（第 699-736 行），在 `releaseActiveStream()` 之前添加 handoff 检查逻辑。

```typescript
// agent-manager.ts, 在 agent_done 事件 emit 后
if (msg.type === 'result') {
  // ... existing agent_done logic ...
  
  // 新增：handoff 合规检查
  const handoffs = db.getAllHandoffs(scopedProjectId);
  const agentHandoffs = handoffs.filter(
    h => h.from_agent_id === agentId && h.to_agent_id !== 'biz_designer'
  );
  if (agentHandoffs.length === 0 && needsHandoff(agentId)) {
    this.addLog(scopedProjectId, agentId, '⚠️ 未创建交接', 
      `${agentId} 完成工作但未创建 handoff`, 'warning');
  }
}
```

| 优点 | 缺点 |
|------|------|
| 最小改动，利用现有基础设施 | 只能检测 SDK-managed sessions |
| 有完整的 agent/project 上下文 | 硬编码在 agent-manager.ts 中 |
| 可以通过 SSE 实时反馈 | 需要定义 `needsHandoff()` 规则 |
| 日志和通知机制已就绪 | 需要修改现有代码 |

**可行性**：✅ **高**

---

## 4. 方案对比总览

| 维度 | 方案 A（PostToolUse） | 方案 B（SDK SessionEnd） | 方案 C（CLI SessionEnd） | 方案 D（扩展 agent-manager） |
|------|---------------------|------------------------|------------------------|---------------------------|
| **检测时机** | 实时（handoff 创建时） | 会话结束时 | 会话结束时 | 会话结束时 |
| **代码侵入性** | 低（加 hooks 配置） | 低（加 hooks 配置） | 无（外部配置） | 中（修改 agent-manager） |
| **反馈能力** | 强（可阻止+日志） | 中（仅日志） | 弱（仅 debug 日志） | 强（SSE + 日志） |
| **覆盖范围** | SDK sessions only | SDK sessions only | 所有 sessions | SDK sessions only |
| **上下文获取** | 直接（tool_input） | 需要额外传参 | 从 transcript/DB 推导 | 直接（完整上下文） |
| **检测 handoff 缺失** | ❌（需结合其他方案） | ✅ | ✅ | ✅ |
| **排除 biz_designer** | ✅ 简单 | ✅ 简单 | ✅ 中等 | ✅ 简单 |
| **推荐优先级** | 辅助 | **首选** | 备选 | **次选** |

---

## 5. 推荐方案：B + A 组合

```
SDK PostToolUse hook (matcher: create_handoff)
  ↓ 实时记录 handoff 创建到内存计数器
  ↓
SDK SessionEnd hook
  ↓ 检查计数器 + DB 查询
  ↓ 如果 agent 完成了工作但没有创建 handoff（排除 biz_designer）
  ↓ 通过 SSE 或日志发出警告
```

### 5.1 具体实现路径

1. 在 `agent-manager.ts` 的 `query()` options 中同时添加 `PostToolUse` 和 `SessionEnd` hooks
2. 在 Class 中添加 `sessionHandoffMap: Map<string, Set<string>>` 追踪每个 session 创建的 handoff
3. `PostToolUse` hook 中：解析 `tool_input.to_agent_id`，如果 ≠ `biz_designer`，记录到 map
4. `SessionEnd` hook 中：检查 map，如果为空且当前 agent role 需要创建 handoff（如 game_designer、ceo、architect、engineer），则触发警告
5. 警告通过 `this.addLog()` 或 `agent_done` SSE 事件携带额外字段发出

### 5.2 "需要创建 handoff" 的判定规则

当前 pipeline 规则（来自 `agents.ts` 的 `HANDOFF_INSTRUCTION`）：

| Agent | 正常应该 handoff 给 | 排除对象 |
|-------|-------------------|---------|
| `game_designer` | `ceo` | - |
| `ceo` | `architect` 或 `biz_designer` | `biz_designer` → 不检查 |
| `architect` | `engineer` | - |
| `engineer` | `biz_designer`（可选） | `biz_designer` → 不检查 |
| `biz_designer` | `ceo` | - |
| `team_builder` | 无 | - |

**简化规则**：对于 `game_designer`、`ceo`、`architect` 这三个角色，如果完成了主要任务但没有创建任何非 biz_designer 的 handoff，发出警告。

---

## 6. 潜在问题与注意事项

1. **Session 边界**：一个 project 中可能有多个 agent 并发工作，需要按 project_id + agent_id + streamId 隔离
2. **Handoff 粒度**：不是每个 agent session 都需要创建 handoff（如 agent 被要求做小修改），需要结合上下文判断
3. **CLI hook 的 transcript 解析风险**：JSONL 文件可能很大（数 MB），解析可能超时（默认 60s）
4. **SDK hook 上下文传递**：`SessionEnd` hook 的 input 只有 session_id，需要通过闭包或外部存储获取 project_id 和 agent_id
5. **`biz_designer` 排除逻辑**：需求说"商业策划除外"，应理解为排除 `to_agent_id === 'biz_designer'` 的 handoff，而不是 `from_agent_id === 'biz_designer'`

---

## 7. 结论

**完全可以实现**。推荐方案：

- **首选**：方案 B（SDK SessionEnd hook） + 方案 A（PostToolUse hook 辅助），在 `agent-manager.ts` 中添加 hooks 配置
- **次选**：方案 D（扩展 agent-manager.ts 现有流程），改动最小但耦合度高
- **备选**：方案 C（CLI SessionEnd hook），零侵入但反馈能力弱

所有方案的核心检测逻辑相同：查询 `handoffs` 表或解析 transcript，判断 agent 是否创建了排除 `biz_designer` 的 handoff。
