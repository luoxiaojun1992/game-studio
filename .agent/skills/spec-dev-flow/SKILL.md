---
name: spec-dev-flow
description: >
  SPEC 开发全流程编排技能。当用户要求开发某个 SPEC、实现某个功能规格、开始 SPEC 开发时触发。
  覆盖从确认 SPEC 编号到文档同步推送的完整 11 步工作流：
  确认编号 → 阅读 memory 文档 → 阅读 spec → 规划任务 → 实现 → review → code-lint → 推送分支 →
  等待人工建 PR → CI 验证修复 → doc-sync 文档同步推送。
agent_created: true
---

# SPEC 开发全流程编排

## 概述

本 skill 将 SPEC 开发全流程标准化为 11 个步骤，确保每个 SPEC 的实现质量一致、文档同步完整。
执行时严格按步骤顺序推进，每步完成后确认再进入下一步。

## 前置条件

- 在 game-dev-studio 项目根目录下执行
- 当前分支为 `main` 且代码已更新到最新
- 已加载 `code-lint`、`ci-verification`、`doc-sync` 三个子 skill

## Skill 发现规则

子 skill 的安装路径可能因环境而异。查找时按以下优先级搜索 SKILL.md：

1. `{game-dev-studio}/.agent/skills/{skill-name}/SKILL.md` — 项目级 skill
2. `~/.workbuddy/skills/{skill-name}/SKILL.md` — 用户级 skill
3. 加载后使用 `Skill` 工具调用

## 工作流

### Step 1 — 确认 SPEC 编号

- 向用户询问 SPEC 编号
- **处理仅输入数字的情况**：用户可能只输入 `017` 而非 `SPEC-017`，自动补全为 `SPEC-XXX` 格式（三位数字，不足三位前面补零）
- 确认后告知用户将要开发的 SPEC 全称

### Step 2 — 阅读 memory 文档

依次阅读以下文档，建立项目全貌认知：

1. `.agent/memory/INDEX.md` — 项目记忆索引，定位相关经验文档
2. `.agent/memory/MEMORY.md` — 关键工程决策记录
3. `.agent/memory/CONVENTIONS.md` — 工作约定、Bug 修复、被纠正的错误做法
4. `.agent/memory/ARCHITECTURE.md` — 项目架构
5. `.agent/memory/E2E_TESTING.md` — E2E 测试经验（如涉及 UI 变更）

**注意**：只阅读与当前 SPEC 相关的 memory 文档，不需要全部读完。根据 SPEC 内容判断哪些文档相关。

### Step 3 — 阅读 SPEC 文档

- 查找路径：`.agent/specs/{spec-file}.md`
- SPEC 文件名通常在 `.agent/specs/INDEX.md` 中可查到
- 完整阅读 spec 文档，理解设计意图、验收标准、UI Test 要求
- 如 spec 文档中有不明确之处，向用户澄清后再继续

### Step 4 — 规划任务列表

- 基于 spec 设计将实现工作分解为具体任务
- 使用 `TaskCreate` 创建结构化任务列表
- 每个任务应包含明确的验收标准
- 将任务列表展示给用户确认

### Step 5 — 实现 SPEC 设计

- 从 `main` 创建功能分支：
  - 分支命名：`feat/SPEC-XXX-{简短描述}`
  - 示例：`feat/SPEC-017-tool-search`
- 按 Step 4 规划的任务顺序逐步实现
- 每完成一个子任务，标记为完成
- 遵循 `.agent/memory/CONVENTIONS.md` 中的编码规范

### Step 6 — Review 代码

- 自查代码质量：
  - 是否满足 spec 验收标准
  - 是否有遗漏的边界情况
  - 是否引入了不安全的代码（XSS、SQL 注入等）
  - 是否有硬编码的敏感信息（token、密码等）
  - 日志是否充分（便于后续 CI 调试）
- 如发现问题，立即修复

### Step 7 — 调用 code-lint 检查修复

- **加载 code-lint skill**：使用 `Skill` 工具加载 `code-lint`
- 对变更文件执行 lint 检查
- 如有 lint 错误，修复后重新检查，直到通过
- 当前 lint 规则：R1（未转义的反引号）

### Step 8 — 推送分支

- 提交代码：
  ```
  git add -A
  git commit -m "feat(SPEC-XXX): {变更描述}"
  ```
- 推送到远端：
  ```
  git push origin feat/SPEC-XXX-{描述}
  ```

### Step 9 — 等待人工创建 PR

- 推送完成后，告知用户：
  - 分支名称
  - 变更摘要
  - 提醒用户手动在 GitHub 上创建 PR
- **等待用户明确告知 PR 已创建**，不要自动轮询

### Step 10 — CI 验证修复

用户确认 PR 已创建后执行：

- **加载 ci-verification skill**：使用 `Skill` 工具加载 `ci-verification`
- 检查 CI 状态（`check-ci.sh`）
- **修复-重试循环**（最多 10 次）：
  1. 获取失败 job 的日志（`get-logs.sh --failed-only`）
  2. 分析失败原因
  3. 修复代码（禁止删除测试用例、禁止降低断言、禁止修改业务逻辑绕过测试）
  4. 推送修复
  5. 等待 CI 重新运行
  6. **即使 CI 变绿也要做假性成功检查**（Step 6：下载全量日志检查隐藏的 HTTP ≥400 错误）
- **CI 全部通过（sonar-check ✅ + ui-tests ✅）才算完成**

### Step 11 — doc-sync 文档同步

CI 完全通过后执行：

- **加载 doc-sync skill**：使用 `Skill` 工具加载 `doc-sync`
- 按 doc-sync 的 8 区遍历（A → H）同步所有相关文档
- 重点检查项（来自 doc-sync Top 10 常见遗漏）：
  1. `README.md` spec 状态更新
  2. `README.md` 工具/服务数量更新
  3. `E2E_TESTING.md` 标题数字匹配
  4. `.agent/specs/INDEX.md` spec 状态一致
  5. `.agent/memory/` 相关文档更新
  6. `AI_AGENT_COMMON_INSTRUCTIONS.md` 工具列表更新
- 将文档变更提交并推送
- 在 workspace memory（`.workbuddy/memory/YYYY-MM-DD.md`）中记录本次开发完成

## 编码规范引用

实现过程中必须遵循的规范（详见 `.agent/memory/CONVENTIONS.md`）：

- **Git 分支命名**：`feat/SPEC-XXX-xxx` 格式
- **Commit message**：`feat(SPEC-XXX): xxx` 格式
- **禁止直接修改 `main` 分支**
- **data-testid**：UI 组件使用 `data-testid` 属性便于 E2E 测试
- **Mock 数据契约**：测试 toolCalls.arguments 必须与 `tools.ts` zod schema 完全匹配
- **禁止删除/降级 UI test case**
- **禁止修改功能逻辑绕过测试**

## 中断与恢复

如果流程被中断：
- 记录当前步骤编号
- 恢复时从断点继续，但需先检查 Step 2（memory 文档）和 Step 3（spec 文档）是否有更新
- 如 `main` 分支有新提交，先 `git checkout main && git pull` 再 `git rebase main`
