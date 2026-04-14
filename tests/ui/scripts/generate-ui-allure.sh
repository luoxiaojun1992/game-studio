#!/bin/bash

set -u

OUT_DIR="tests/ui/artifacts/allure-report"
PRIMARY_RESULTS="tests/ui/artifacts/allure-results"
LEGACY_RESULTS="artifacts/allure-results"

ALLURE_CMD=()
if command -v allure >/dev/null 2>&1; then
  ALLURE_CMD=(allure)
elif npx --no-install allure --version >/dev/null 2>&1; then
  ALLURE_CMD=(npx --no-install allure)
else
  echo "[error] allure cli not available"
  exit 1
fi

if ! command -v java >/dev/null 2>&1; then
  echo "[error] java not available; cannot generate Allure HTML report"
  exit 1
fi

RESULTS_DIR=""
if [ -d "$PRIMARY_RESULTS" ]; then
  RESULTS_DIR="$PRIMARY_RESULTS"
elif [ -d "$LEGACY_RESULTS" ]; then
  RESULTS_DIR="$LEGACY_RESULTS"
fi

if [ -z "$RESULTS_DIR" ]; then
  echo "[error] no allure results directory found"
  exit 1
fi

if [ -z "$(find "$RESULTS_DIR" -maxdepth 1 -type f \( -name '*-result.json' -o -name '*-container.json' \) -print -quit)" ]; then
  echo "[error] no allure result json files found in $RESULTS_DIR"
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

if ! "${ALLURE_CMD[@]}" generate "$RESULTS_DIR" --clean -o "$OUT_DIR"; then
  echo "[error] allure report generation failed"
  exit 1
fi

if [ ! -f "$OUT_DIR/index.html" ]; then
  echo "[error] generated allure report is invalid: missing $OUT_DIR/index.html"
  exit 1
fi
