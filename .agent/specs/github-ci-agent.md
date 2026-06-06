# Coding Agent GitHub CI 调试规范

> **SPEC-013** | 状态：设计中

## 目标

规范 coding agent（WorkBuddy）在开发过程中读取 GitHub Actions CI 执行情况、检查调试日志、判断 UI Test 是否通过、并自主修复代码直至 UI Test 全部通过的完整工作流。

**本 spec 的 "agent" 指的是 coding agent（即 WorkBuddy 自身），不是 game-dev-studio 项目内的 engineer agent 或 MCP 工具。** 本规范不涉及项目 `server/` 目录的任何代码变更。

核心能力：
1. **PAT 凭证约定**：约定 GitHub Personal Access Token 的本地存储方式，不纳入 git 版本控制
2. **CI 状态读取**：agent 通过 `gh` CLI 或 `curl` + PAT 调用 GitHub REST API，查询 workflow run 状态、job 列表、step 日志
3. **UI Test 调试循环**：agent 读取失败日志 → 定位问题 → 修改代码 → 推送 → 等待 CI → 循环，直至 UI Test 全部通过

## 背景

当前 UI Test 运行在 GitHub Actions（`.github/workflows/ci.yml` 的 `ui-tests` job）。开发调试流程中，coding agent 需要：
- push 代码后，自动获取本次 push 触发的 workflow run 状态
- 下载 `allure-report` / `playwright-report` artifact 中的测试日志
- 读取失败测试的 stdout/stderr，定位根因
- 修改代码后再次 push，循环迭代直至 CI 绿灯

## 凭证约定

### 环境变量（推荐）

在本地 shell 配置（`~/.zshrc` / `~/.bashrc`）中设置：

```bash
export GITHUB_PAT="ghp_xxxxxxxxxxxx"
```

coding agent 通过 `process.env.GITHUB_PAT` 或 shell `echo $GITHUB_PAT` 读取。

### 本地文件（备选）

将 PAT 写入项目根目录下的 `.github-pat` 文件（仅包含 PAT 字符串，无换行）：

```
ghp_xxxxxxxxxxxx
```

agent 读取优先级：`GITHUB_PAT` 环境变量 > `.github-pat` 文件。

### .gitignore 规则

以下条目必须存在于 `.gitignore` 中，**不得纳入版本控制**：

```gitignore
# GitHub PAT 本地凭证文件（SPEC-013，禁止纳入版本控制）
/.github-pat
```

### 安全要求

- PAT 权限范围：`repo`（含 `actions:read`），最小化授权
- **禁止**将 PAT 写入任何被 git 追踪的文件
- agent 日志/输出中禁止打印 PAT 明文；如需 debug 可打印前 4 位 + `****`
- `.github-pat` 文件权限建议 `chmod 600`

## agent 操作方式

coding agent 通过以下两种方式之一调用 GitHub API：

### 方式一：`gh` CLI（推荐）

`gh` 已预装在 macOS 和 GitHub Actions runner 中，支持 `GITHUB_PAT` 环境变量鉴权。

```bash
# 列出最近 5 次 CI run
gh api repos/{owner}/{repo}/actions/runs \
  --method GET \
  -f per_page=5 \
  -f branch=main \
  --jq '.workflow_runs[] | {id, status, conclusion, head_branch, created_at}'

# 获取指定 run 详情
gh api repos/{owner}/{repo}/actions/runs/{run_id} \
  --jq '{id, status, conclusion, head_sha, html_url}'

# 列出 run 的 jobs
gh api repos/{owner}/{repo}/actions/runs/{run_id}/jobs \
  --jq '.jobs[] | {id, name, status, conclusion, steps: [.steps[] | {name, conclusion, number}]}'

# 下载 job 日志（自动跟随 302 重定向）
gh api repos/{owner}/{repo}/actions/jobs/{job_id}/logs > /tmp/ci-job-${job_id}-logs.zip
unzip -o /tmp/ci-job-${job_id}-logs.zip -d /tmp/ci-job-${job_id}-logs/

# 列出 artifacts
gh api repos/{owner}/{repo}/actions/runs/{run_id}/artifacts \
  --jq '.artifacts[] | {id, name, size_in_bytes, expired}'

# 下载 artifact
gh api repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip > /tmp/ci-artifact-${artifact_id}.zip
unzip -o /tmp/ci-artifact-${artifact_id}.zip -d /tmp/ci-artifact-${artifact_id}/
```

> `gh api` 自动读取 `GITHUB_PAT` 环境变量作为鉴权，无需额外传参。

### 方式二：`curl` + PAT

当 `gh` CLI 不可用时，使用 `curl`：

```bash
# 设置鉴权头（每条命令引用 $GITHUB_PAT）
GH_AUTH="-H Authorization: Bearer $GITHUB_PAT -H Accept: application/vnd.github+json"

# 列出 runs
curl -s $GH_AUTH "https://api.github.com/repos/{owner}/{repo}/actions/runs?per_page=5&branch=main" | jq '.'

# 获取 run 详情
curl -s $GH_AUTH "https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}" | jq '.'

# 列出 jobs
curl -s $GH_AUTH "https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/jobs" | jq '.'

# 下载 job 日志（需跟随 302）
curl -sL $GH_AUTH -o /tmp/ci-job-logs.zip "https://api.github.com/repos/{owner}/{repo}/actions/jobs/{job_id}/logs"

# 下载 artifact（需跟随 302）
curl -sL $GH_AUTH -o /tmp/ci-artifact.zip "https://api.github.com/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip"
```

> `curl -sL` 中 `-L` 跟随 302 重定向。GitHub API v3 的日志和 artifact 下载端点均返回 302 到预签名 S3 URL。

### 仓库信息获取

agent 通过 `git remote get-url origin` 解析仓库 owner/repo：

```bash
git remote get-url origin
# git@github.com:luoxiaojun1992/game-studio.git → owner=luoxiaojun1992, repo=game-studio
```

解析规则：
- SSH 格式 `git@github.com:{owner}/{repo}.git` → 提取 `{owner}/{repo}`
- HTTPS 格式 `https://github.com/{owner}/{repo}.git` → 提取 `{owner}/{repo}`

## GitHub Actions 工作流参考

当前项目 CI 配置（`.github/workflows/ci.yml`）：

| 维度 | 值 |
|------|------|
| Workflow 名称 | `CI` |
| 触发条件 | `push`（main 分支）、`pull_request`（所有分支） |
| Jobs | `sonar-check` → `ui-tests`（串行依赖） |
| UI Test Job 名 | `ui-tests` |
| UI Test 超时 | 45 分钟 |
| Artifact 名称 | `allure-report`、`sonar-report` |
| allure-report 包含 | `tests/ui/artifacts/allure-report`、`tests/ui/artifacts/allure-results`、`tests/ui/artifacts/test-results`、`tests/ui/artifacts/ui-coverage-summary.json`、`tests/ui/artifacts/playwright-report/results.json` |

### agent 关键关注点

1. **`ui-tests` job 的 `conclusion`**：`success` = 全通过，`failure` = 有测试失败
2. **失败 step 的日志**：`ui-tests` job 下失败 step 的 name + 日志内容
3. **`playwright-report/results.json`**：测试结果摘要，含每个测试用例的 status / duration / error message
4. **`allure-results/`**：详细 step 级别日志（XML 格式），含截图附件

## UI Test 自动调试循环

### 循环流程

```
┌─────────────────────────────────────────────────────────────┐
│              Coding Agent UI Test 调试循环                    │
│                                                             │
│  1. git push → 获取 push 后的 commit SHA                    │
│                                                             │
│  2. 查询最新 workflow run                                    │
│     gh api .../actions/runs?branch=<当前分支>               │
│     └─> 找到 run_id，匹配 commit SHA                        │
│                                                             │
│  3. 检查 run 状态                                            │
│     ├─> status == "in_progress" / "queued"                 │
│     │     → 等待 60s，回到步骤 3                             │
│     ├─> conclusion == "success"                            │
│     │     → 退出，UI Test 全通过                              │
│     └─> conclusion == "failure"                            │
│         → 进入步骤 4                                        │
│                                                             │
│  4. 获取 ui-tests job 详情                                  │
│     gh api .../actions/runs/{run_id}/jobs                   │
│     └─> 找到 name == "ui-tests" 的 job                      │
│                                                             │
│  5. 下载失败 job 的日志                                      │
│     gh api .../actions/jobs/{job_id}/logs > logs.zip        │
│     unzip → 搜索 FAILED / Error / ✘                        │
│                                                             │
│  6. 可选：下载 allure-report artifact                       │
│     → 读取 playwright-report/results.json                  │
│     → 获取失败用例名、error message、截图路径                 │
│                                                             │
│  7. 分析日志 → 定位代码问题 → 修改代码                       │
│                                                             │
│  8. git push → 回到步骤 2                                   │
│                                                             │
│  安全退出条件：                                               │
│  - 最大迭代 10 次                                            │
│  - 连续 3 次相同错误                                         │
│  - run 被 cancelled / skipped                                │
│  - 超时 45 分钟（与 CI timeout 对齐）                        │
└─────────────────────────────────────────────────────────────┘
```

### 循环退出条件

| 条件 | 处理 |
|------|------|
| UI Test 全部通过（`conclusion == "success"`） | 正常退出，向用户报告成功 |
| 超过最大迭代次数（10 次） | 退出，报告迭代超次数，输出失败摘要，等待用户介入 |
| 连续 3 次相同错误无法修复 | 退出，输出错误摘要和已尝试的修复方案，请求用户介入 |
| run 状态为 `cancelled` | 退出，提示 CI 被手动取消，检查是否有人操作 |
| run 状态为 `skipped` | 退出，检查上游 job（sonar-check）是否失败导致跳过 |

### 等待策略

- run 状态为 `queued` 或 `in_progress` 时，每 **60 秒**轮询一次 `gh api .../actions/runs/{run_id}`
- 单次 run 超时上限：**45 分钟**（与 `ci.yml` 中 `timeout-minutes: 45` 对齐）
- 轮询使用单次 run 查询（GET `/actions/runs/{run_id}`），不使用列表查询，减少 API 消耗

### 日志分析要点

agent 下载 job 日志后，重点搜索以下失败模式：

```
# Playwright 测试失败
✘ [UI-xxx] 测试名称
Error: ...
  at ...

# Docker 容器启动失败
Error response from daemon: ...
container exited with code ...

# 编译 / 类型错误
error TS...
FAILED: ...

# 网络 / 依赖拉取失败
npm ERR! ...
ECONNREFUSED ...
```

### Artifact 中的关键文件

| 文件路径 | 用途 |
|---------|------|
| `tests/ui/artifacts/playwright-report/results.json` | Playwright 测试结果摘要：每个用例的 status、duration、error message、attachments |
| `tests/ui/artifacts/allure-results/` | Allure 详细结果（XML），含 step 级别日志和截图 |
| `tests/ui/artifacts/test-results/` | Playwright raw 输出（HTML 报告源文件） |
| `tests/ui/artifacts/ui-coverage-summary.json` | 测试覆盖率摘要 |

## agent 行为规范

### push 前检查

在执行 `git push` 之前，agent 应确认：
1. 代码已通过本地编译（`npx tsc --noEmit`）或至少无明显的语法错误
2. 修改有针对性，不是盲目试探
3. commit message 遵循 Conventional Commits 规范

### push 后跟踪

push 后 agent 应：
1. 立即获取远端最新 run_id（不需要等待，通常几秒内触发）
2. 进入等待 → 轮询循环
3. **不要在等待期间执行其他代码修改**（避免冲突）

### 日志清理

下载的 CI 日志和 artifact 放在 `/tmp/` 下，agent 应在调试循环结束后清理：
```bash
rm -rf /tmp/ci-job-*/ /tmp/ci-artifact-*/
```

## 注意事项

- **API Rate Limit**：GitHub REST API 每小时 5000 次（PAT 鉴权），调试循环 60s 间隔完全足够，不会触发限制
- **日志大小**：job 日志可能超过 100MB（zip 后约 5-20MB），agent 下载后应用 `grep` / `tail` 定位失败点，避免全量读取
- **302 跳转**：`gh api` 自动跟随重定向；`curl` 需 `-L` 参数；重定向后的 S3 URL 不含鉴权头
- **PAT 不注入容器**：本规范仅用于宿主机上的 coding agent，不涉及任何 Docker 容器环境变量配置
- **Artifact 有效期**：GitHub Actions artifact 默认保留 90 天，调试时注意 `expired` 字段，过期 artifact 不可下载
- **不要为了绕过 CI 失败而跳过测试**：禁止修改 `ci.yml`、禁用 job、或将测试标记为 skip 来"通过" CI

## 后续实现文档更新清单

本 spec 进入实现阶段（配置 PAT 后首次使用）时，需同步更新以下 `.agent` 文档：

| 文件 | 更新内容 |
|------|---------|
| `.agent/memory/CONVENTIONS.md` | 新增「CI 调试约定」条目：PAT 读取优先级、`gh` CLI 使用规范、调试循环安全退出条件、禁止跳过测试的红线 |
| `.agent/memory/ARCHITECTURE.md` | 新增「GitHub Actions CI」条目：ci.yml 工作流结构（sonar-check → ui-tests）、artifact 名称与路径、workflow/job/step 关系 |
| `.agent/memory/INDEX.md` | 新增 SPEC-013 条目，方便 agent 快速定位规范 |
| `.agent/memory/MEMORY.md` | 记录 SPEC-013 工程决策：PAT 凭证方案选择、调试循环参数（10 次上限、60s 轮询、45min 超时） |
| `.agent/AI_AGENT_COMMON_INSTRUCTIONS.md` | 在「测试规范」或「编码规范」章节补充 CI 调试流程说明：push 后如何检查 CI 状态、下载日志、分析失败 |
| `.agent/specs/INDEX.md` | 更新 SPEC-013 状态为「已实现」 |
| `.agent/specs/github-ci-agent.md` | 更新头部状态为「已实现」 |

> **不相关的文档不需要修改**：`E2E_TESTING.md`、`LINT.md`、`SDK_MOCK.md`、`STAROFFICE.md`、`REUSABLE_PATTERNS.md` 与本功能无关。
