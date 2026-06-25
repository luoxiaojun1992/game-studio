#!/bin/bash
# Download CI job logs for a workflow run via GitHub API.
# Usage: ./get-logs.sh <run-id> [--dir OUTPUT_DIR] [--failed-only]
#   --dir         Output directory (default: ./ci-logs-<run-id>)
#   --failed-only Only download logs for failed jobs
#
# Auth: GITHUB_TOKEN env var, or reads from <repo-root>/.github-pat

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: get-logs.sh <run-id> [--dir OUTPUT_DIR] [--failed-only]"
  exit 1
fi

RUN_ID="$1"
shift

REPO_ROOT="$(git rev-parse --show-toplevel)"
OUTPUT_DIR="./ci-logs-${RUN_ID}"
FAILED_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)         OUTPUT_DIR="$2"; shift 2 ;;
    --failed-only) FAILED_ONLY=true; shift ;;
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

HEADER_AUTH="Authorization: token $TOKEN"
HEADER_API="Accept: application/vnd.github+json"
JOBS_API="https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/jobs"

mkdir -p "$OUTPUT_DIR"

echo "📥 Downloading logs for run #$RUN_ID"
echo "   Output: $OUTPUT_DIR"
echo ""

# ── Fetch job list ──
JOBS_RESP=$(curl -sf -H "$HEADER_AUTH" -H "$HEADER_API" "$JOBS_API" 2>/dev/null) || {
  echo "ERROR: Failed to fetch jobs for run #$RUN_ID" >&2
  exit 1
}

# Parse and download each job log
echo "$JOBS_RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for job in data.get('jobs', []):
    jid = job['id']
    name = job['name']
    conclusion = job.get('conclusion', 'running')
    print(f'{jid}\t{name}\t{conclusion}')
" | while IFS=$'\t' read -r job_id job_name job_conclusion; do

  if [ "$FAILED_ONLY" = true ] && [ "$job_conclusion" != "failure" ]; then
    echo "  ⏭️  Skipping [${job_conclusion}] $job_name"
    continue
  fi

  LOG_FILE="${OUTPUT_DIR}/${job_name// /_}-${job_id}.log"
  LOG_URL="https://api.github.com/repos/$REPO/actions/jobs/${job_id}/logs"
  echo "  📄 [$job_conclusion] $job_name → $(basename "$LOG_FILE")"

  # GitHub redirects log downloads — follow redirect
  curl -sL -H "$HEADER_AUTH" "$LOG_URL" -o "$LOG_FILE" 2>/dev/null || {
    echo "     ⚠️  Failed to download (job may still be running)" >&2
    continue
  }

  # Size check
  if [ -f "$LOG_FILE" ]; then
    SIZE=$(wc -c < "$LOG_FILE" | tr -d ' ')
    echo "     ${SIZE} bytes"

    # Extract key error lines for quick scanning
    if grep -q -iE '\b(error|fail|exception)\b' "$LOG_FILE" 2>/dev/null; then
      echo "     🔴 Key errors:"
      grep -n -iE '\b(error|fail|exception)\b' "$LOG_FILE" | head -20 | sed 's/^/       /'
    fi
  fi

  echo ""
done

echo "📊 Logs saved to: $OUTPUT_DIR/"

JOB_COUNT=$(echo "$JOBS_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('jobs',[])))")
FAIL_COUNT=$(grep -l -iE '\b(error|fail|exception)\b' "$OUTPUT_DIR"/*.log 2>/dev/null | wc -l | tr -d ' ')
echo "   ${FAIL_COUNT}/${JOB_COUNT} job(s) with errors"
