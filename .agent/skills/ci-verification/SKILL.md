---
name: ci-verification
description: "GitHub Actions CI verification and bug-fix cycle for game-dev-studio. This skill should be used when verifying code changes through CI (sonar-check then ui-tests), polling CI run status, downloading failure logs, or executing the push-wait-fix-retry loop. Triggers include: check CI, verify PR, CI status, wait for CI, download CI logs, fix CI failure, CI failed, ui-test failed."
agent_created: true
---

# CI Verification Skill — game-dev-studio

Verify code changes through GitHub Actions CI and execute the debug-fix-retry cycle
when tests fail.

## Prerequisites

- Working directory: the root of the game-dev-studio repo
- GitHub token (priority order):
  1. `GITHUB_TOKEN` environment variable
  2. `.github-pat` file in repo root (auto-read by scripts)
  3. `gh auth token` (fallback, requires `gh` CLI)

## Workflow Overview

```
Code change → git push → CI triggers automatically
                              │
                              ▼
                     sonar-check (30 min)
                              │
                              ▼
                      ui-tests (45 min)
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
                 All pass             Failure
                    │                    │
                    ▼                    ▼
                  Done             Analyze logs
                                      │
                                      ▼
                                  Fix code
                                      │
                                      ▼
                                  git push ──→ (back to CI trigger)
```

## Tool Scripts

All scripts live under `scripts/` in the skill directory. The paths below are relative to wherever this skill is installed.

### wait-for-ci.sh — Poll Until Complete (core script)

Poll CI check runs until `sonar-check` + `ui-tests` both complete (or timeout).
Uses GitHub Checks API directly — no `gh` CLI required.

```bash
# Default: 120s interval, 1h timeout
bash scripts/wait-for-ci.sh feat/my-branch

# Custom interval and timeout
bash scripts/wait-for-ci.sh feat/my-branch --interval 60 --timeout 1800
```

- Shows per-job status (✅/❌/⏳) on each change
- Prints dots between identical statuses to show liveness
- Exits immediately if all jobs are already complete
- Exit codes: 0=all pass, 1=failure, 124=timeout
- On failure: prints instructions to download logs and fix root cause

**🚨 MANDATORY: Foreground execution only**

`wait-for-ci.sh` MUST be executed in the **foreground** — never as a background task.
The agent must block and wait synchronously for the script to complete. This is critical because:

1. The agent needs to see the real-time status output to report progress to the user
2. The exit code (0/1/124) determines the next step in the debug-fix-retry cycle
3. Background execution breaks the polling loop — the dots and status updates are lost
4. The agent cannot proceed to log analysis or code fixes until CI completes

**Correct usage:**
```bash
# Foreground — agent blocks until CI completes or times out
bash scripts/wait-for-ci.sh
```

**Wrong usage (forbidden):**
```bash
# ❌ NEVER run in background
bash scripts/wait-for-ci.sh &   # forbidden
# ❌ NEVER use Bash tool's run_in_background=true
# ❌ NEVER nohup, disown, or any detached execution mode
```

### check-ci.sh — Quick Status Check

Check current CI status for a branch (no polling).

```bash
# Check current branch
bash scripts/check-ci.sh

# Check specific branch
bash scripts/check-ci.sh feat/my-branch

# Exit codes: 0=all pass, 1=failure, 2=still running
```

### get-logs.sh — Download Failure Logs

Download job logs for a specific workflow run via GitHub Actions API.

```bash
# Download all job logs
bash scripts/get-logs.sh 12345678

# Download only failed job logs
bash scripts/get-logs.sh 12345678 --failed-only

# Custom output directory
bash scripts/get-logs.sh 12345678 --dir ./my-ci-logs
```

- Extracts error/failure lines for quick scanning
- Output: one `.log` file per job in the output directory
- Auto-follows GitHub log download redirects

## Debug-Fix-Retry Cycle

When CI fails, follow this cycle (max 10 retries):

### Step 1: Get the failing run ID

```bash
bash scripts/check-ci.sh
```

### Step 2: Download failure logs

```bash
bash scripts/get-logs.sh <run-id> --failed-only
```

### Step 3: Analyze the failure

Open the downloaded logs and identify the root cause. See `references/ci-workflow.md` for:
- The full 9-test matrix and what each test verifies
- Key artifact paths for debugging (`playwright-report/results.json`, `test-results/`, etc.)
- Docker compose service dependency graph

**Critical rules for analysis:**
- Never use workarounds — fix the root cause, not the symptom
- Never relax assertions to make tests pass
- UI element mismatches → add `data-testid` attributes, don't change selectors
- Mock data must match zod schemas exactly

**🚫 Red-line rules — zero tolerance:**
- **NEVER delete a UI test case** to make CI pass
- **NEVER downgrade a test assertion** (e.g. `toPass()` → `toPass({ timeout })`, removing checks, `.skip`, `.fixme`)
- **NEVER modify business logic** to work around a test failure — the test is telling you something is wrong
- **Face the problem directly**: root-cause the failure, fix the actual bug, and let the test confirm the fix

### Step 4: Fix the code

Apply the fix based on root cause analysis. Common failure patterns:
- Test selector not matching → Add `data-testid` to the frontend component
- Mock data mismatch → Align `setMockExpectation` arguments with tool zod schemas
- Docker proxy issues → Ensure `~/.docker/config.json` has no `proxies` field
- SSE channel mismatch → Verify `project_id` is correctly scoped

### Step 5: Push and re-verify

```bash
git add -A && git commit -m "fix: <describe fix>" && git push
# MUST run in foreground — blocks until CI completes
bash scripts/wait-for-ci.sh
```

Repeat steps 2–5 until CI passes or retry limit (10) is reached.

### Step 6: 假性成功排查 — 检查日志中的隐藏错误

**CI "passed" ≠ 真的没问题。** Mock chains 会掩盖真实的 API 错误，导致测试通过但底层服务实际返回了错误码。CI 通过后必须执行以下检查：

#### 6.1 下载完整日志

```bash
# 下载 ui-tests job 的完整日志（不仅 failed-only）
GITHUB_TOKEN=$(cat .github-pat) curl -sL \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/{owner}/{repo}/actions/jobs/{ui_tests_job_id}/logs" \
  -o /tmp/ui-tests-full.log
```

#### 6.2 检查微服务 HTTP 错误码

```bash
# 逐个微服务过滤 >=400 的错误响应（排除 /health 检查）
cat /tmp/ui-tests-full.log \
  | grep "{service_name}-1" \
  | grep -v "/health" \
  | grep -E "HTTP/[0-9.]+\" [45][0-9]{2}"
```

当以下任一容器出现 >=400 状态码时，CI 视为**假性成功**，必须修复：

| 容器 | 覆盖范围 | 常见假性成功 |
|------|---------|-------------|
| `image-service-1` | ImageMagick API | 422 (格式不支持), 404 (文件不存在) |
| `video-service-1` | FFmpeg API | 422 (单帧输入), 404, 500 (编码错误) |
| `creator-1` | Blender API | 404, 422 |
| `drawio-service-1` | Draw.io API | 404, 422 |
| `scanner-1` | SonarQube Scanner | 连接超时 |
| `studio-backend-1` | Studio Backend | 500 (未捕获异常) |

#### 6.3 检查应用层错误日志

HTTP 200 不意味着业务逻辑正确。还需检查错误级别的日志输出：

```bash
# 搜索 Error/ERROR/fail/异常 等关键字（排除误匹配）
cat /tmp/ui-tests-full.log \
  | grep -iE "\b(error|fail|exception|panic)\b" \
  | grep -v "error message above" \
  | grep -v "expected.*error" \
  | grep -v "/health"
```

常见掩藏在 200 响应中的错误：
- `[Tool] ... NOT_FOUND` — 工具执行失败但返回了友好文本而非抛出异常
- `Error: ...` — 非致命错误被 catch 吞掉
- `TypeError: Cannot read properties of undefined` — 数据缺失导致静默降级
- `UnhandledPromiseRejection` — 异步异常未被上层捕获

> **处理原则**：发现任何隐藏错误，即使 CI 显示 "success"，也必须定位根因并修复。假性成功 = 实际失败。

### get-videos.sh — Download Branch-Related UI Test Videos

After CI passes, download the UI test recordings for tests modified on the current branch.

```bash
bash scripts/get-videos.sh <run-id>

# Custom output directory
bash scripts/get-videos.sh 12345678 --dir ./my-videos
```

**How it works:**
1. Downloads the `allure-report` artifact from the CI run
2. Detects which UI tests are new/changed on this branch (`git diff origin/main`)
3. Extracts only the matching `video.webm` files
4. Names them `UI-XXX-video.webm` for easy identification

**Prerequisites:**
- `gh` CLI authenticated (uses `GH_TOKEN` or `gh auth login`)
- Working directory: game-dev-studio repo root
- `origin/main` must be fetchable for diff comparison

### After CI Passes (all checks + logs clean)

- Download branch-related UI test videos:
  ```bash
  bash scripts/get-videos.sh <run-id>
  ```
- Mark the task as complete
- Update daily memory log with the fix summary
- If the root cause was a non-obvious pattern, update `references/ci-workflow.md` or project CONVENTIONS.md

## Full Automation (One Command)

For a complete push-and-verify cycle:

```bash
# 1. Push changes
git push

# 2. Wait for CI and report result (FOREGROUND — blocks until done)
bash scripts/wait-for-ci.sh
```

If the above fails, proceed to the debug-fix-retry cycle.

> ⚠️  The agent MUST run wait-for-ci.sh in the foreground and block until it exits.
> Do NOT use background execution or any detached mode for this script.

## Reference

Load `references/ci-workflow.md` for the detailed CI job structure, 9-test matrix,
artifact paths, and service dependency graph.
