#!/bin/bash
# Check CI run status for a branch.
# Usage: ./check-ci.sh [branch-name]
#   branch-name defaults to current git branch.
#
# Prerequisites: gh CLI installed and authenticated (gh auth status).

set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REPO="${GITHUB_REPO:-$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo '')}"

if [ -z "$REPO" ]; then
  echo "ERROR: Could not determine repo. Set GITHUB_REPO env var or run 'gh auth login'." >&2
  exit 1
fi

echo "🔍 Checking CI runs for branch: $BRANCH"
echo "   Repo: $REPO"
echo ""

# Get the latest workflow run for this branch
RUN_JSON=$(gh run list \
  --repo "$REPO" \
  --branch "$BRANCH" \
  --workflow ci.yml \
  --limit 1 \
  --json databaseId,status,conclusion,headBranch,displayTitle,createdAt,url 2>/dev/null || echo '[]')

if [ "$RUN_JSON" = "[]" ]; then
  echo "⚠️  No CI runs found for branch '$BRANCH'"
  exit 0
fi

RUN_ID=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['databaseId'])")
STATUS=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['status'])")
CONCLUSION=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['conclusion'])")
TITLE=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['displayTitle'])")
URL=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['url'])")
CREATED=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['createdAt'])")

echo "📋 Latest Run: #$RUN_ID — $TITLE"
echo "   Status:     $STATUS"
echo "   Conclusion: ${CONCLUSION:-pending}"
echo "   Created:    $CREATED"
echo "   URL:        $URL"
echo ""

# Show per-job status
echo "📊 Job Status:"
gh run view "$RUN_ID" --repo "$REPO" --json jobs --jq '
  .jobs[] | "   [\(.conclusion // .status | ascii_upcase | lpadstr(8; " "))] \(.name)"
' 2>/dev/null || echo "   (unable to fetch job details)"

# Exit code: 0 if all jobs passed, 1 otherwise
CONCLUSION_LOWER=$(echo "$CONCLUSION" | tr '[:upper:]' '[:lower:]')
if [ "$CONCLUSION_LOWER" = "success" ]; then
  echo ""
  echo "✅ All CI jobs passed!"
  exit 0
elif [ "$CONCLUSION_LOWER" = "failure" ]; then
  echo ""
  echo "❌ CI has failing jobs. Run 'get-logs.sh $RUN_ID' to download logs."
  exit 1
else
  echo ""
  echo "⏳ CI is still running (status: $STATUS). Use 'wait-for-ci.sh $BRANCH' to poll."
  exit 2
fi
