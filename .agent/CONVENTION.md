# 开发调试约定 (Development Debug Conventions)

本文档记录项目中常用的调试模式和经验总结。

---

## 1. 打日志调试（Console Debug）

### 1.1 日志输出位置

在 Node.js 后端代码中，使用 `console.error()` 输出调试日志到 stderr（方便在日志文件中过滤）：

```typescript
// ✅ 正确：使用 console.error 输出调试日志
console.error(`[DEBUG tool_name] START agentId=${agentId} projectId=${projectId}`);

// ❌ 错误：使用 console.log（可能被 stdout 缓冲）
console.log(`DEBUG: something`);
```

### 1.2 日志关键字命名规范

| 日志类型 | 关键字格式 | 示例 |
|---------|-----------|------|
| 调试日志 | `[DEBUG 模块名]` | `[DEBUG submit_game]`, `[DEBUG write_game_file]` |
| Mock 日志 | `[mock-debug]` | `[mock-debug] queued for`, `[mock-debug] consumed exp` |
| Agent 日志 | `[DEBUG agent-*]` | `[DEBUG agent-tool-call]`, `[DEBUG agent-tool-result]` |
| 错误日志 | `[ERROR 模块名]` | `[ERROR submit_game] file not found` |

### 1.3 日志内容规范

日志应包含关键变量信息，便于定位问题：

```typescript
// ✅ 好日志：包含关键上下文
console.error(`[DEBUG submit_game] START projectId=${scopedProjectId} gameName=${name} resolvedPath=${resolvedFilePath}`);
console.error(`[DEBUG submit_game] targetPath=${targetPath} exists=${exists} isDirectory=${isDirectory}`);
console.error(`[DEBUG submit_game] SUCCESS game_submitted broadcasted gameId=${game.id}`);

// ❌ 差日志：信息不足或冗余
console.error("DEBUG: starting submit_game");
console.error(`targetPath=${targetPath} and something=${somethingElse}`); // 上下文不清晰
```

### 1.4 在 GitHub Actions 中排查日志

在 CI/CD 日志中搜索关键字：

```bash
# 搜索特定模块的调试日志
grep "\[DEBUG submit_game\]" workflow-logs.txt

# 搜索 Mock 相关日志
grep "\[mock-debug\]" workflow-logs.txt

# 搜索 Agent 工具调用
grep "\[DEBUG agent-tool" workflow-logs.txt
```

### 1.5 典型问题排查清单

#### Mock 期望顺序问题
- **症状**：`[mock-debug] NO expectation for engineer`
- **原因**：Engineer 的 mock 期望被其他 LLM 决策提前消耗
- **排查**：检查 LLM 是否按预期顺序调用工具

#### 文件操作失败
- **症状**：`[DEBUG submit_game] targetPath=... exists=false`
- **原因**：前置工具（如 write_game_file）未成功执行
- **排查**：检查 `[DEBUG write_game_file]` 日志

#### 前端 SSE 事件未接收
- **症状**：`game_submitted` 广播后前端没有更新
- **原因**：前端 `selectedProjectId` 与事件中的 `project_id` 不匹配
- **排查**：检查 `project_id` 值是否一致

---

## 2. Playwright E2E 测试调试

### 2.1 测试日志输出

Playwright 测试中的 `console.log` 和 `process.stderr.write` 会在测试输出中显示：

```typescript
const log = (step: string, extra?: Record<string, unknown>) => {
  let payload = '';
  if (extra) try { payload = ` ${JSON.stringify(extra)}` } catch { payload = ` ${String(extra)}` }
  process.stderr.write(`${debugPrefix} ${new Date().toISOString()} ${step}${payload}\n`);
};
```

### 2.2 常用调试命令

```bash
# 运行单个测试
npx playwright test --grep "UI-007"

# 显示 UI 截图
npx playwright test --ui

# 保留测试数据
npx playwright test --retain-on-failure
```

---

## 3. 日志级别使用指南

| 级别 | 用途 | 示例 |
|-----|------|------|
| `console.error()` | 调试日志、错误 | `[DEBUG ...]`, `[ERROR ...]` |
| `log()` (项目日志) | 正常操作日志 | `log(agentId, '提交游戏', '游戏已提交', 'success')` |
| `console.warn()` | 警告信息 | `console.warn('[WARN] deprecated API')` |

---

## 5. UI 授权弹窗调试（Permission Request）

### 5.1 背景

当 Agent 调用某些工具时，后端会检查 `CAN_AUTO_ALLOW` 列表。如果工具不在列表中或需要额外验证，会触发 `permission_request` 事件，前端弹出授权对话框。

### 5.2 权限配置位置

权限配置在 `server/agent-manager.ts` 的 `CAN_AUTO_ALLOW` 数组中：

```typescript
const CAN_AUTO_ALLOW = [
  // 读操作：所有 Agent 均可自动使用
  'save_memory', 'get_memories', 'get_project_latest_info', ...
  // 需要授权的工具：根据条件添加
  ...(isEngineer ? ['submit_game'] : []),  // 需要 UI 授权
  'write_game_file',  // 自动允许（见下方说明）
];
```

### 5.3 工具分类

| 类型 | 说明 | 示例 |
|------|------|------|
| 读操作 | 所有 Agent 可自动使用 | `save_memory`, `get_tasks` |
| 受控操作 | 仅特定 Agent 可调用，需要 UI 授权 | `submit_game` |
| 自动操作 | 仅特定 Agent 可调用，**无需 UI 授权** | `write_game_file` |

### 5.4 添加新授权工具的规则

1. **确定调用权限**：哪些 Agent 可以调用（检查 `isEngineer` 等条件）
2. **确定授权方式**：
   - 需要 UI 授权：`...(isEngineer ? ['tool_name'] : [])`
   - 无需 UI 授权：`'tool_name'`（直接添加）
3. **在 `STUDIO_TOOL_NAMES` 中注册**：确保工具名被识别

```typescript
// 需要 UI 授权（engineer 专用）
...(isEngineer ? ['submit_game'] : []),

// 无需 UI 授权（engineer 专用，仅操作本地 output 目录）
'write_game_file',
```

### 5.5 E2E 测试中处理授权弹窗

UI-007 等 E2E 测试必须正确处理所有授权弹窗。测试流程中如果 Agent 调用了需要授权的工具，测试需要：

1. **监听授权弹窗**：检测到 `permission_request` 事件
2. **自动批准**：`page.click('[data-testid="approve-button"]')` 或类似操作

```typescript
// 示例：监听并自动批准授权请求
const handlePermissionRequest = async (page: Page) => {
  // 等待授权弹窗出现
  await page.waitForSelector('[data-testid="permission-dialog"]', { timeout: 5000 });
  // 点击批准按钮
  await page.click('[data-testid="approve-button"]');
  // 等待弹窗关闭
  await page.waitForSelector('[data-testid="permission-dialog"]', { state: 'hidden' });
};
```

### 5.6 调试授权问题

**症状**：Action 日志中缺少 `[DEBUG tool_name]` 日志，但测试应该调用了该工具。

**可能原因**：
1. 工具不在 `CAN_AUTO_ALLOW` 列表中，触发了授权弹窗
2. E2E 测试没有正确处理授权弹窗，导致 Agent 等待超时
3. 调用 Agent 不是工具允许的角色（如 `isEngineer` 检查）

**排查步骤**：
1. 检查 Action 日志中是否有 `[permission]` 日志
2. 确认工具是否在 `CAN_AUTO_ALLOW` 列表中
3. 确认调用 Agent 是否符合权限条件
4. 如果工具不需要授权但仍在等待，检查是否在 `STUDIO_TOOL_NAMES` 中注册

```bash
# 搜索权限请求日志
grep "\[permission\]" workflow-logs.txt
```

### 5.7 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 测试挂起，Agent 不响应 | 授权弹窗未处理 | 在测试中添加授权弹窗处理逻辑 |
| `[DEBUG tool]` 日志未出现 | 工具需要授权但测试未批准 | 将工具加入 `CAN_AUTO_ALLOW` 或确保测试批准授权 |
| "权限不足" 错误 | 调用 Agent 不是允许的角色 | 确认工具的 `isEngineer` 等条件 |

---

## 6. 添加新调试日志的最佳实践

1. **明确目的**：每条日志都应有明确的调试目的
2. **包含上下文**：打印关键变量值
3. **使用统一格式**：`[DEBUG 模块名] 操作 关键信息`
4. **结束时打印**：标注操作成功或失败
5. **不泄露敏感信息**：不要在日志中打印密码、token 等

```typescript
// 完整示例
console.error(`[DEBUG submit_game] START projectId=${projectId} gameName=${name}`);

try {
  // 操作前
  console.error(`[DEBUG submit_game] checking path=${targetPath}`);

  // 操作
  fsModule.writeFileSync(targetPath, content);

  // 成功后
  console.error(`[DEBUG submit_game] SUCCESS wrote ${content.length} bytes`);
} catch (err) {
  // 失败后
  console.error(`[DEBUG submit_game] ERROR ${err}`);
  throw err;
}
```
