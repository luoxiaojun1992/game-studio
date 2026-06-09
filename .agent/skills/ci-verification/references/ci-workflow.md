# CI Workflow Reference — game-dev-studio

## Workflow: `.github/workflows/ci.yml`

Triggers: `pull_request` and `push` to `main`

### Jobs

| Order | Job | Timeout | Depends On |
|:---|:---|:---|:---|
| 1 | `sonar-check` | 30 min | — |
| 2 | `ui-tests` | 45 min | sonar-check |

### sonar-check

```
docker compose -f docker-compose-sonar-check.yml up --abort-on-container-exit --exit-code-from sonar-scanner sonar-scanner
```

- Artifact: `sonar-report` (path: `scanner-report/`)
- Always uploads (even on failure)
- Always tears down (`docker compose down -v`)

### ui-tests

```
mkdir -p tests/ui/artifacts
env UID="$(id -u)" GID="$(id -g)" docker compose -f docker-compose.ui-test.yml build --no-cache
env UID="$(id -u)" GID="$(id -g)" docker compose -f docker-compose.ui-test.yml up --abort-on-container-exit --exit-code-from ui-e2e
```

- Artifact: `allure-report`
  - `tests/ui/artifacts/allure-report`
  - `tests/ui/artifacts/allure-results`
  - `artifacts/allure-results`
  - `tests/ui/artifacts/test-results`
  - `tests/ui/artifacts/ui-coverage-summary.json`
  - `tests/ui/artifacts/playwright-report/results.json`
- Always uploads (even on failure)
- Always tears down (`docker compose down -v`)

### Key Debug Info

When `ui-tests` fails, the most useful info is in:
1. `playwright-report/results.json` — which tests failed and their error messages
2. `test-results/` — Playwright trace files and screenshots
3. `allure-results/` — structured test results for Allure report generation

### 9-Test Matrix

| ID | Category | Mock Needed | What It Verifies |
|:---|:---|:---:|:---|
| UI-001 | Page load | No | Title + team overview visible |
| UI-002 | Language switch | No | Chinese/English toggle |
| UI-003 | Autopilot | No | Toggle switch |
| UI-004 | Project management | No | Create + switch project |
| UI-005 | Tab navigation | No | 8 tabs all clickable |
| UI-006 | Star-Office integration | No | iframe load + agent state sync |
| UI-007 | Full workflow (manual) | Yes | 3 handoffs + 1 game |
| UI-008 | Full workflow (auto) | Yes | Same + autopilot |
| UI-009 | Manual proposal creation | Yes | Form fill + SSE update |
