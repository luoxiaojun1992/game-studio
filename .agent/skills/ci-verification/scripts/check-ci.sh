#!/bin/bash
# Quick CI status check for a branch via GitHub Checks API.
# Usage: ./check-ci.sh [branch-name]
#   branch-name defaults to current git branch.
#
# Auth: GITHUB_TOKEN env var, or reads from <repo-root>/.github-pat
# Exit codes: 0=all pass, 1=failure, 2=still running, 3=auth error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

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

# ── Detect repo from git remote ──
REPO=$(git -C "$REPO_ROOT" remote get-url origin | sed 's|.*github.com[:/]||; s|\.git$||')
if [ -z "$REPO" ]; then echo "ERROR: could not detect GitHub repo" >&2; exit 1; fi

API="https://api.github.com/repos/$REPO/commits/$BRANCH/check-runs"
HEADER_AUTH="Authorization: token $TOKEN"
HEADER_API="Accept: application/vnd.github+json"

echo "🔍 CI status for branch: $BRANCH"
echo "   Repo: $REPO"
echo ""

RESP=$(curl -sf -H "$HEADER_AUTH" -H "$HEADER_API" "$API" 2>/dev/null) || {
  echo "ERROR: API request failed (branch may not exist or token invalid)" >&2
  exit 2
}

echo "$RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
runs = data.get('check_runs', [])
if not runs:
    print('⚠️  No check runs found')
    sys.exit(0)

all_pass = True
any_running = False
for r in runs:
    name = r['name']
    status = r['status']
    conclusion = r.get('conclusion', '-')
    if status != 'completed':
        any_running = True
        conclusion = '...'
    elif conclusion != 'success' and conclusion != 'neutral' and conclusion != 'skipped':
        all_pass = False
    print(f'   [{conclusion:12s}] {name}')

print()
if any_running:
    print('⏳ Some jobs still running. Use wait-for-ci.sh to poll.')
    sys.exit(2)
elif all_pass:
    print('✅ All CI jobs passed!')
    sys.exit(0)
else:
    print('❌ CI has failures.')
    sys.exit(1)
"
EXIT_CODE=$?
exit $EXIT_CODE
