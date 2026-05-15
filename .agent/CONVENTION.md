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

## 4. 添加新调试日志的最佳实践

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
