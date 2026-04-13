#!/bin/bash

set -u

OUT_DIR="tests/ui/artifacts/allure-report"
PRIMARY_RESULTS="tests/ui/artifacts/allure-results"
LEGACY_RESULTS="artifacts/allure-results"

copy_results_fallback() {
  rm -rf "$OUT_DIR"
  mkdir -p "$OUT_DIR"

  if [ -d "$PRIMARY_RESULTS" ]; then
    cp -r "$PRIMARY_RESULTS" "$OUT_DIR/allure-results"
    return 0
  fi

  if [ -d "$LEGACY_RESULTS" ]; then
    cp -r "$LEGACY_RESULTS" "$OUT_DIR/allure-results"
    return 0
  fi

  echo "[warn] no allure results found; created empty allure report directory"
  return 0
}

if command -v allure >/dev/null 2>&1 && command -v java >/dev/null 2>&1; then
  allure generate "$PRIMARY_RESULTS" --clean -o "$OUT_DIR" && exit 0
  allure generate "$LEGACY_RESULTS" --clean -o "$OUT_DIR" && exit 0
  echo "[warn] allure generate failed; falling back to raw allure results copy"
  copy_results_fallback
  exit 0
fi

if ! command -v allure >/dev/null 2>&1; then
  echo "[warn] allure cli not available; using fallback artifact copy"
elif ! command -v java >/dev/null 2>&1; then
  echo "[warn] allure generate skipped; java not available"
fi

copy_results_fallback
