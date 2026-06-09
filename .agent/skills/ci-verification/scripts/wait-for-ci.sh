#!/bin/bash
# Poll CI run until completion or timeout.
# Usage: ./wait-for-ci.sh [branch-name] [--interval SECONDS] [--timeout SECONDS]
#   branch-name defaults to current git branch.
#   interval  defaults to 60s.
#   timeout   defaults to 2700s (45 min).
#
# Prerequisites: gh CLI installed and authenticated.

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
INTERVAL=60
TIMEOUT=2700  # 45 min = CI timeout

# Parse optional flags (shift past first arg if it's a branch name)
shift 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2";  shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

REPO="${GITHUB_REPO:-$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo '')}"
if [ -z "$REPO" ]; then
  echo "ERROR: Could not determine repo. Set GITHUB_REPO env var." >&2
  exit 1
fi

echo "⏳ Waiting for CI on branch '$BRANCH'..."
echo "   Repo: $REPO | Interval: ${INTERVAL}s | Timeout: ${TIMEOUT}s"
echo ""

get_run_info() {
  gh run list --repo "$REPO" --branch "$BRANCH" --workflow ci.yml --limit 1 \
    --json databaseId,status,conclusion,displayTitle,url 2>/dev/null
}

print_jobs() {
  local run_id="$1"
  gh run view "$run_id" --repo "$REPO" --json jobs --jq '
    .jobs[] | "   [\(.conclusion // .status | ascii_upcase | lpadstr(10; " "))] \(.name)"
  ' 2>/dev/null
}

START_TIME=$(date +%s)
PREV_STATUS=""
LAST_RUN_ID=""
POLL_COUNT=0

while true; do
  ELAPSED=$(($(date +%s) - START_TIME))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo ""
    echo "⏰ Timeout after ${TIMEOUT}s. Last run: #${LAST_RUN_ID:-N/A}"
    exit 124
  fi

  RUN_DATA=$(get_run_info)

  if [ "$RUN_DATA" = "[]" ] || [ -z "$RUN_DATA" ]; then
    sleep "$INTERVAL"
    continue
  fi

  RUN_ID=$(echo "$RUN_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['databaseId'])")
  STATUS=$(echo "$RUN_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['status'])")
  CONCLUSION=$(echo "$RUN_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['conclusion'])")
  TITLE=$(echo "$RUN_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['displayTitle'])")

  STATUS_KEY="${RUN_ID}:${STATUS}:${CONCLUSION}"

  if [ "$STATUS_KEY" != "$PREV_STATUS" ]; then
    POLL_COUNT=$((POLL_COUNT + 1))
    ELAPSED_MIN=$((ELAPSED / 60))
    echo "[+${ELAPSED_MIN}m] Run #$RUN_ID — $TITLE"
    echo "         Status: $STATUS | Conclusion: ${CONCLUSION:-pending}"
    print_jobs "$RUN_ID"
    PREV_STATUS="$STATUS_KEY"
  else
    # Print a dot every interval to show we're still polling
    echo -n "."
  fi

  LAST_RUN_ID="$RUN_ID"

  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo ""
    if [ "$CONCLUSION" = "success" ]; then
      echo "✅ All CI jobs passed! ($POLL_COUNT polls over ${ELAPSED}s)"
      exit 0
    else
      echo "❌ CI failed. Conclusion: $CONCLUSION"
      echo ""
      echo "To download logs, run: get-logs.sh $RUN_ID"
      exit 1
    fi
  fi

  sleep "$INTERVAL"
done
