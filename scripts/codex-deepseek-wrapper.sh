#!/usr/bin/env bash
set -euo pipefail

# codex-deepseek-wrapper.sh
# Shell wrapper for Codex CLI that routes DeepSeek model selections
# through the correct provider/profile.
#
# This wrapper is useful when you want a single "codex" entrypoint that
# automatically uses the DeepSeek profile when deepseek-v4-pro is selected.
#
# The VS Code bridge (codex-vscode-deepseek-bridge.js) is the recommended
# approach for VS Code. This shell wrapper is for terminal-only usage.
#
# Usage:
#   export DEEPSEEK_API_KEY="your_api_key_here"
#   ./scripts/codex-deepseek-wrapper.sh exec "Reply exactly: ok"

CODEX_BIN="${CODEX_BIN:-codex}"
DEEPSEEK_PROFILE="${DEEPSEEK_PROFILE:-deepseek-v4-pro}"

# Check if the arguments mention a DeepSeek model.
is_deepseek_request() {
  for arg in "$@"; do
    case "$arg" in
      deepseek*|deep-seek*)
        return 0
        ;;
    esac
  done
  return 1
}

# If the request looks like a DeepSeek model invocation, inject the profile.
if is_deepseek_request "$@"; then
  exec "$CODEX_BIN" --profile "$DEEPSEEK_PROFILE" "$@"
else
  exec "$CODEX_BIN" "$@"
fi
