#!/bin/bash
set -euo pipefail

# ── 0. 前置条件 ───────────────────────────────────────────────
# depends_on: sonarqube condition:service_healthy 已保证 SonarQube 就绪
# 但首次启动时 SonarQube 可能还在后台执行 migrations，所以多等一下
echo "[entrypoint] Waiting for SonarQube to be fully ready..."
until curl -sf "http://sonarqube:9000/api/system/status" | grep -q '"status":"UP"'; do
  echo "[entrypoint] SonarQube not ready, waiting 5s..."
  sleep 5
done
echo "[entrypoint] SonarQube is UP"

# ── 1. 生成 API Token ─────────────────────────────────────────
# 用 Basic Auth（admin:sonarpass）调 /api/user_tokens/generate
# 每次运行生成一个新的 token，名字带时间戳避免冲突
SONAR_USER="${SONAR_USER:-admin}"
SONAR_PASSWORD="${SONAR_PASSWORD:-admin}"
TOKEN_NAME="scanner-$(date +%Y%m%d%H%M%S)"

echo "[entrypoint] Generating SonarQube API token: ${TOKEN_NAME}"
TOKEN_RESPONSE=$(curl -s -X POST "http://sonarqube:9000/api/user_tokens/generate" \
  -u "${SONAR_USER}:${SONAR_PASSWORD}" \
  -d "name=${TOKEN_NAME}" \
  -d "type=USER_TOKEN")

API_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [[ -z "$API_TOKEN" ]]; then
  echo "[entrypoint] ERROR: Failed to generate API token"
  echo "[entrypoint] Response: $TOKEN_RESPONSE"
  exit 1
fi
echo "[entrypoint] Token generated successfully"

# ── 2. 运行 Sonar Scanner ─────────────────────────────────────
echo "[entrypoint] Starting sonar-scanner..."
export SONAR_TOKEN="$API_TOKEN"
export SONAR_HOST_URL="${SONAR_HOST_URL:-http://sonarqube:9000}"

sonar-scanner \
  -Dsonar.token="$API_TOKEN" \
  -Dsonar.host.url="$SONAR_HOST_URL" \
  "$@"

SCAN_EXIT=$?
echo "[entrypoint] sonar-scanner exited with code: $SCAN_EXIT"

# ── 3. 解析 Report ────────────────────────────────────────────
# 输出目录挂载到 /report（GitHub Actions artifact 上传用）
REPORT_HOST_DIR="/usr/src/scanner-report"
mkdir -p "$REPORT_HOST_DIR"
chmod 777 "$REPORT_HOST_DIR"

echo "[entrypoint] Parsing scan report..."
python3 /parse_report.py \
  --host "$SONAR_HOST_URL" \
  --token "$API_TOKEN" \
  --project game-studio \
  --output "$REPORT_HOST_DIR/sonar-issues.json"

echo "[entrypoint] Report written to $REPORT_HOST_DIR/sonar-issues.json"
echo "[entrypoint] Done. Scanner exit code: $SCAN_EXIT"

exit $SCAN_EXIT