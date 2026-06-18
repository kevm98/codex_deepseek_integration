#!/usr/bin/env bash
set -euo pipefail

# verify-setup.sh
# Comprehensive verification script for the DeepSeek Codex integration.
# Checks Moon Bridge connectivity, Codex profile, VS Code wrapper, and
# environment configuration.
#
# Usage:
#   ./scripts/verify-setup.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
MOONBRIDGE_URL="${MOONBRIDGE_URL:-http://127.0.0.1:38440}"
PASSED=0
FAILED=0

green() { printf '\033[32m  PASS\033[0m %s\n' "$*"; }
red()   { printf '\033[31m  FAIL\033[0m %s\n' "$*" >&2; }
warn()  { printf '\033[33m  WARN\033[0m %s\n' "$*"; }
info()  { printf '\033[36m  INFO\033[0m %s\n' "$*"; }

check() {
  if "$@"; then
    green "$1"
    PASSED=$((PASSED + 1))
  else
    red "$1"
    FAILED=$((FAILED + 1))
  fi
}

echo "============================================"
echo " Codex DeepSeek Integration Setup Verification"
echo "============================================"
echo ""

# --- Environment ---
echo "--- Environment ---"

if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  green "DEEPSEEK_API_KEY is set"
  PASSED=$((PASSED + 1))
else
  warn "DEEPSEEK_API_KEY is not set (bridge may not work)"
fi

# --- Moon Bridge ---
echo ""
echo "--- Moon Bridge ---"

if curl -sf "$MOONBRIDGE_URL/v1/models" > /dev/null 2>&1; then
  green "Moon Bridge is reachable at $MOONBRIDGE_URL"
  PASSED=$((PASSED + 1))
else
  warn "Moon Bridge is not reachable at $MOONBRIDGE_URL"
  info "Check: systemctl --user status codex-moonbridge.service"
fi

# --- Codex CLI ---
echo ""
echo "--- Codex CLI ---"

if command -v codex > /dev/null 2>&1; then
  green "codex is on PATH"
  PASSED=$((PASSED + 1))
else
  red "codex is not on PATH"
fi

# --- Profile ---
echo ""
echo "--- Profile ---"

PROFILE_FILE="$CODEX_HOME/deepseek-v4-pro.config.toml"
if [ -f "$PROFILE_FILE" ]; then
  green "DeepSeek profile exists: $PROFILE_FILE"
  PASSED=$((PASSED + 1))

  if grep -q 'model_provider.*moonbridge' "$PROFILE_FILE" 2>/dev/null; then
    green "Profile has moonbridge provider configured"
    PASSED=$((PASSED + 1))
  elif grep -q 'model_provider.*deepseek' "$PROFILE_FILE" 2>/dev/null; then
    info "Profile uses LiteLLM/deepseek provider (fallback mode)"
  else
    warn "Profile may have unexpected provider configuration"
  fi
else
  warn "DeepSeek profile not found at $PROFILE_FILE"
  info "Run: ./scripts/install-moonbridge.sh"
fi

# --- Model Catalog ---
echo ""
echo "--- Model Catalog ---"

CATALOG_FILE="$CODEX_HOME/models_catalog.json"
if [ -f "$CATALOG_FILE" ]; then
  green "Model catalog exists: $CATALOG_FILE"
  PASSED=$((PASSED + 1))
else
  warn "Model catalog not found (VS Code picker may be incomplete)"
fi

# --- VS Code Wrapper ---
echo ""
echo "--- VS Code Wrapper ---"

WRAPPER_PATH="$CODEX_HOME/bin/codex-vscode-deepseek-bridge"
if [ -f "$WRAPPER_PATH" ]; then
  if [ -x "$WRAPPER_PATH" ]; then
    green "VS Code wrapper is installed and executable"
    PASSED=$((PASSED + 1))
  else
    warn "VS Code wrapper exists but is not executable"
    info "Run: chmod +x $WRAPPER_PATH"
  fi
else
  info "VS Code wrapper not installed (optional, for VS Code usage only)"
  info "Run: CONFIGURE_VSCODE=1 ./scripts/install-moonbridge.sh"
fi

# --- systemd ---
echo ""
echo "--- systemd Services ---"

if systemctl --user is-active codex-moonbridge.service > /dev/null 2>&1; then
  green "Moon Bridge systemd service is active"
  PASSED=$((PASSED + 1))
elif systemctl --user cat codex-moonbridge.service > /dev/null 2>&1; then
  warn "Moon Bridge service exists but is not active"
  info "Run: systemctl --user start codex-moonbridge.service"
else
  info "Moon Bridge systemd service not installed (optional)"
fi

# --- .gitignore check ---
echo ""
echo "--- Repository Hygiene ---"

if [ -f "$ROOT/.gitignore" ]; then
  if grep -q '\.env$' "$ROOT/.gitignore" 2>/dev/null; then
    green ".gitignore covers .env"
    PASSED=$((PASSED + 1))
  else
    warn ".gitignore may not cover .env"
  fi
else
  warn ".gitignore not found"
fi

# --- Summary ---
echo ""
echo "============================================"
echo " Results: $PASSED passed, $FAILED failed"
echo "============================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
