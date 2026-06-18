#!/usr/bin/env bash
set -euo pipefail

# install-litellm.sh
# LiteLLM fallback installer for Codex + DeepSeek.
# Sets up a Python virtual environment with LiteLLM proxy,
# installs bridge files, and configures the DeepSeek profile.
#
# Requirements:
#   - Python 3 and pip
#   - DEEPSEEK_API_KEY set in environment
#
# Usage:
#   export DEEPSEEK_API_KEY="your_api_key_here"
#   ./scripts/install-litellm.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV="$CODEX_HOME/litellm-venv"

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "DEEPSEEK_API_KEY is not set." >&2
  echo "Export it first: export DEEPSEEK_API_KEY=\"your_api_key_here\"" >&2
  exit 1
fi

mkdir -p "$CODEX_HOME/bin" "$CODEX_HOME/.tmp"

# Create virtual environment if it does not exist.
if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install "litellm[proxy]"

# Install bridge files.
install -m 0644 "$ROOT/scripts/deepseek_codex_callbacks.py" \
  "$CODEX_HOME/deepseek_codex_callbacks.py"
install -m 0644 "$ROOT/examples/litellm-deepseek.yaml" \
  "$CODEX_HOME/litellm-deepseek.yaml"
install -m 0755 "$ROOT/scripts/codex-deepseek-bridge" \
  "$CODEX_HOME/bin/codex-deepseek-bridge"

# Generate model catalog with DeepSeek entry.
if [ -x "$ROOT/scripts/append-deepseek-model-entry.sh" ]; then
  "$ROOT/scripts/append-deepseek-model-entry.sh" \
    "$CODEX_HOME/codex-models-with-deepseek.json"
fi

# Write profile config with resolved paths.
sed "s#{{CODEX_HOME}}#$CODEX_HOME#g" \
  "$ROOT/examples/deepseek-v4-pro.config.toml" \
  > "$CODEX_HOME/deepseek-v4-pro.config.toml"
install -m 0644 "$ROOT/examples/gpt55.config.toml" \
  "$CODEX_HOME/gpt55.config.toml"

# Install and start systemd service if available.
if systemctl --user cat codex-deepseek-bridge.service >/dev/null 2>&1 || true; then
  echo "LiteLLM systemd service already installed." >&2
else
  sed "s#{{CODEX_HOME}}#$CODEX_HOME#g" \
    "$ROOT/systemd/codex-deepseek-bridge.service" \
    > "$HOME/.config/systemd/user/codex-deepseek-bridge.service"
  systemctl --user daemon-reload
  systemctl --user enable --now codex-deepseek-bridge.service
  echo "LiteLLM systemd service installed and started." >&2
fi

echo "LiteLLM fallback installed." >&2
echo "Test with: codex exec --profile deepseek-v4-pro \"Reply exactly: ok\"" >&2
