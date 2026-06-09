---
name: ci-verification
description: "GitHub Actions CI verification and bug-fix cycle for game-dev-studio. This skill should be used when verifying code changes through CI (sonar-check then ui-tests), polling CI run status, downloading failure logs, or executing the push-wait-fix-retry loop. Triggers include: check CI, verify PR, CI status, wait for CI, download CI logs, fix CI failure, CI failed, ui-test failed."
agent_created: true
---

# CI Verification Skill — game-dev-studio

Verify code changes through GitHub Actions CI and execute the debug-fix-retry cycle
when tests fail.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status`)
- `GITHUB_REPO` env var set, or the repo auto-detected via `gh repo view`
- Working directory: the root of the game-dev-studio repo

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

All scripts live under `scripts/` and assume the working directory is the repo root.

### check-ci.sh — Quick Status Check

Check the latest CI run for a branch.

```bash
# Check current branch
bash .agent/skills/ci-verification/scripts/check-ci.sh

# Check specific branch
bash .agent/skills/ci-verification/scripts/check-ci.sh chore/my-fix

# Exit codes: 0=pass, 1=fail, 2=still running
```

Output includes:
- Run ID, status, conclusion, URL
- Per-job status table (sonar-check, ui-tests)

### wait-for-ci.sh — Poll Until Complete

Poll CI until `sonar-check` + `ui-tests` both complete (or timeout).

```bash
# Default: 60s interval, 45min timeout
bash .agent/skills/ci-verification/scripts/wait-for-ci.sh chore/my-fix

# Custom interval and timeout
bash .agent/skills/ci-verification/scripts/wait-for-ci.sh chore/my-fix --interval 30 --timeout 1800
```

- Prints polling progress with elapsed time
- Shows per-job status on each update
- Exit codes: 0=all pass, 1=failure, 124=timeout

### get-logs.sh — Download Failure Logs

Download job logs for a specific CI run.

```bash
# Download all job logs
bash .agent/skills/ci-verification/scripts/get-logs.sh 12345678

# Download only failed job logs
bash .agent/skills/ci-verification/scripts/get-logs.sh 12345678 --failed-only

# Custom output directory
bash .agent/skills/ci-verification/scripts/get-logs.sh 12345678 --dir ./my-ci-logs
```

- Extracts error/failure lines for quick scanning
- Output: one `.log` file per job in the output directory

## Debug-Fix-Retry Cycle

When CI fails, follow this cycle (max 10 retries):

### Step 1: Get the failing run ID

```bash
bash .agent/skills/ci-verification/scripts/check-ci.sh
```

### Step 2: Download failure logs

```bash
bash .agent/skills/ci-verification/scripts/get-logs.sh <run-id> --failed-only
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

### Step 4: Fix the code

Apply the fix based on root cause analysis. Common failure patterns:
- Test selector not matching → Add `data-testid` to the frontend component
- Mock data mismatch → Align `setMockExpectation` arguments with tool zod schemas
- Docker proxy issues → Ensure `~/.docker/config.json` has no `proxies` field
- SSE channel mismatch → Verify `project_id` is correctly scoped

### Step 5: Push and re-verify

```bash
git add -A && git commit -m "fix: <describe fix>" && git push
bash .agent/skills/ci-verification/scripts/wait-for-ci.sh
```

Repeat steps 2–5 until CI passes or retry limit (10) is reached.

### After CI Passes

- Mark the task as complete
- Update daily memory log with the fix summary
- If the root cause was a non-obvious pattern, update `references/ci-workflow.md` or project CONVENTIONS.md

## Full Automation (One Command)

For a complete push-and-verify cycle:

```bash
# 1. Push changes
git push

# 2. Wait for CI and report result
bash .agent/skills/ci-verification/scripts/wait-for-ci.sh
```

If the above fails, proceed to the debug-fix-retry cycle.

## Reference

Load `references/ci-workflow.md` for the detailed CI job structure, 9-test matrix,
artifact paths, and service dependency graph.
