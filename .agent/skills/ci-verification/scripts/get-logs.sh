#!/bin/bash
# Download CI job logs for a workflow run.
# Usage: ./get-logs.sh <run-id> [--dir OUTPUT_DIR] [--failed-only]
#   --dir         Output directory (default: ./ci-logs-<run-id>)
#   --failed-only Only download logs for failed jobs
#
# Prerequisites: gh CLI installed and authenticated.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: get-logs.sh <run-id> [--dir OUTPUT_DIR] [--failed-only]"
  exit 1
fi

RUN_ID="$1"
shift

OUTPUT_DIR="./ci-logs-${RUN_ID}"
FAILED_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)         OUTPUT_DIR="$2"; shift 2 ;;
    --failed-only) FAILED_ONLY=true; shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

REPO="${GITHUB_REPO:-$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo '')}"
if [ -z "$REPO" ]; then
  echo "ERROR: Could not determine repo. Set GITHUB_REPO env var." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "📥 Downloading logs for run #$RUN_ID"
echo "   Output: $OUTPUT_DIR"
echo ""

# Get job list
if [ "$FAILED_ONLY" = true ]; then
  JOB_FILTER='.jobs[] | select(.conclusion == "failure")'
else
  JOB_FILTER='.jobs[]'
fi

JOBS=$(gh run view "$RUN_ID" --repo "$REPO" --json jobs 2>/dev/null)

if [ -z "$JOBS" ]; then
  echo "ERROR: Could not fetch jobs for run #$RUN_ID" >&2
  exit 1
fi

JOB_COUNT=$(echo "$JOBS" | python3 -c "import sys,json; jobs=json.load(sys.stdin)['jobs']; print(len([j for j in jobs]))")
echo "Found $JOB_COUNT job(s)"
echo ""

echo "$JOBS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for job in data['jobs']:
    print(f\"{job['databaseId']}\t{job['name']}\t{job.get('conclusion','running')}\")
" | while IFS=$'\t' read -r job_id job_name job_conclusion; do

  if [ "$FAILED_ONLY" = true ] && [ "$job_conclusion" != "failure" ]; then
    echo "  ⏭️  Skipping [${job_conclusion}] $job_name"
    continue
  fi

  LOG_FILE="${OUTPUT_DIR}/${job_name// /_}-${job_id}.log"
  echo "  📄 Downloading [$job_conclusion] $job_name → $(basename "$LOG_FILE")"

  gh run view --repo "$REPO" --job "$job_id" --log 2>/dev/null > "$LOG_FILE" || \
    gh run view --repo "$REPO" --job "$job_id" --log-failed 2>/dev/null > "$LOG_FILE" || \
    echo "     ⚠️  Failed to download" >&2

  # Extract key error lines for quick scanning
  if grep -q -i 'error\|fail\|FAIL\|Error\|exception\|assert' "$LOG_FILE" 2>/dev/null; then
    echo "     🔴 Errors found:"
    grep -n -i 'error\|fail\|FAIL\|Error\|exception\|assert' "$LOG_FILE" | head -20 | sed 's/^/       /'
  fi

  echo ""
done

# Summary
FAIL_COUNT=$(grep -l -i 'error\|fail\|FAIL\|Error' "$OUTPUT_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
echo "📊 Summary: $FAIL_COUNT/$JOB_COUNT job(s) have errors"
echo "   Logs saved to: $OUTPUT_DIR/"
