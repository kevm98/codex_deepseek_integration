#!/usr/bin/env bash
set -euo pipefail

# test-deepseek-codex.sh
# Quick smoke test for the DeepSeek Codex integration.
# Checks that Moon Bridge is running and Codex can use the DeepSeek profile.
#
# Usage:
#   ./scripts/test-deepseek-codex.sh

MOONBRIDGE_URL="${MOONBRIDGE_URL:-http://127.0.0.1:38440}"
CODEX_BIN="${CODEX_BIN:-codex}"
PROFILE="${PROFILE:-deepseek-v4-pro}"
PASSED=0
FAILED=0

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

check() {
  local label="$1"
  shift
  if "$@"; then
    green "  PASS: $label"
    PASSED=$((PASSED + 1))
  else
    red "  FAIL: $label"
    FAILED=$((FAILED + 1))
  fi
}

echo "=== Codex DeepSeek Integration Test ==="
echo ""

# Check Moon Bridge is reachable.
echo "--- Moon Bridge ---"
check "Moon Bridge /v1/models responds" \
  curl -sf "$MOONBRIDGE_URL/v1/models" > /dev/null

# Check Codex is available.
echo "--- Codex CLI ---"
check "codex is on PATH" command -v "$CODEX_BIN" > /dev/null

# Check profile exists.
echo "--- Profile ---"
check "DeepSeek profile exists" \
  test -f "$HOME/.codex/${PROFILE}.config.toml"

# Quick smoke test with Codex.
echo "--- Smoke test ---"
if "$CODEX_BIN" exec --profile "$PROFILE" --strict-config --ephemeral --json "Reply exactly: ok" > /dev/null 2>&1; then
  green "  PASS: Codex exec with DeepSeek profile"
  PASSED=$((PASSED + 1))
else
  red "  FAIL: Codex exec with DeepSeek profile (bridge may need restart)"
  FAILED=$((FAILED + 1))
fi

echo ""
echo "=== Results: $PASSED passed, $FAILED failed ==="
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
