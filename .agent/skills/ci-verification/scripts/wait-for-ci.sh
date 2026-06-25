#!/bin/bash
# Poll CI check runs until completion (or timeout), then output final result.
# Usage: ./wait-for-ci.sh [branch-name] [--interval SECONDS] [--timeout SECONDS]
#   branch-name defaults to current git branch.
#   interval  defaults to 120s.
#   timeout   defaults to 3600s (1 hour).
#
# Auth: GITHUB_TOKEN env var, or reads from <repo-root>/.github-pat
# Exit codes: 0=all pass, 1=failure, 124=timeout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

INTERVAL=120
TIMEOUT=3600  # 1 hour

# Parse flags
shift 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2";  shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Auth ──
get_token() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then echo "$GITHUB_TOKEN"; return 0; fi
  if [ -f "$REPO_ROOT/.github-pat" ]; then cat "$REPO_ROOT/.github-pat" | head -1; return 0; fi
  if command -v gh &>/dev/null; then
    local t
    t=$(gh auth token 2>/dev/null || true)
    if [ -n "$t" ]; then echo "$t"; return 0; fi
  fi
  return 1
}

TOKEN=$(get_token) || { echo "ERROR: No GitHub token found. Set GITHUB_TOKEN or create .github-pat" >&2; exit 3; }

# ── Detect repo ──
REPO=$(git -C "$REPO_ROOT" remote get-url origin | sed 's|.*github.com[:/]||; s|\.git$||')
if [ -z "$REPO" ]; then echo "ERROR: could not detect GitHub repo" >&2; exit 1; fi

API="https://api.github.com/repos/$REPO/commits/$BRANCH/check-runs"
HEADER_AUTH="Authorization: token $TOKEN"
HEADER_API="Accept: application/vnd.github+json"

echo "⏳ Polling CI for branch '$BRANCH'"
echo "   Repo: $REPO | Interval: ${INTERVAL}s | Timeout: ${TIMEOUT}s"
echo ""

# ── Polling loop ──
START_TIME=$(date +%s)
PREV_SUMMARY=""
POLL_COUNT=0

while true; do
  ELAPSED=$(($(date +%s) - START_TIME))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo ""
    echo "⏰ Timeout after ${TIMEOUT}s (${POLL_COUNT} polls)"
    exit 124
  fi

  RESP=$(curl -sf -H "$HEADER_AUTH" -H "$HEADER_API" "$API" 2>/dev/null) || {
    echo -n "x"
    sleep "$INTERVAL"
    continue
  }

  # Build status summary
  SUMMARY=$(echo "$RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
runs = data.get('check_runs', [])
if not runs:
    print('NO_RUNS')
    sys.exit(0)

lines = []
all_done = True
for r in sorted(runs, key=lambda x: x['name']):
    name = r['name']
    status = r['status']
    conclusion = r.get('conclusion', '-')
    if status == 'completed':
        icon = '✅' if conclusion == 'success' else '❌' if conclusion == 'failure' else '⚪'
    else:
        icon = '⏳'
        all_done = False
    lines.append(f'{icon} {name}={conclusion}')

print(' | '.join(lines))
if all_done:
    # Check overall: all critical jobs must be success
    critical_jobs = {'sonar-check', 'ui-tests'}
    for r in runs:
        if r['name'] in critical_jobs:
            if r.get('conclusion') != 'success':
                print('OVERALL_FAIL')
                sys.exit(0)
    print('OVERALL_PASS')
  " 2>/dev/null)

  POLL_COUNT=$((POLL_COUNT + 1))
  ELAPSED_MIN=$((ELAPSED / 60))

  if [ "$SUMMARY" != "$PREV_SUMMARY" ]; then
    printf "[+%dm] #%d  %s\n" "$ELAPSED_MIN" "$POLL_COUNT" "$SUMMARY"
    PREV_SUMMARY="$SUMMARY"
  else
    echo -n "."
  fi

  # Check for completion
  if echo "$SUMMARY" | grep -q "OVERALL_PASS"; then
    echo ""
    echo ""
    echo "✅ All CI jobs passed! (${POLL_COUNT} polls over ${ELAPSED}s)"
    exit 0
  elif echo "$SUMMARY" | grep -q "OVERALL_FAIL"; then
    echo ""
    echo ""
    echo "❌ CI failed."
    echo ""
    echo "To analyze:"
    echo "  1. Download logs:  bash scripts/get-logs.sh <run-id> --failed-only"
    echo "  2. Fix root cause (NEVER delete tests or relax assertions)"
    echo "  3. Push fix then re-run:  git push && bash scripts/wait-for-ci.sh"
    exit 1
  fi

  sleep "$INTERVAL"
done
