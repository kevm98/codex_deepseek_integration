#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV="$CODEX_HOME/litellm-venv"

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  echo "DEEPSEEK_API_KEY is not set." >&2
  exit 1
fi

mkdir -p "$CODEX_HOME/bin" "$CODEX_HOME/.tmp"

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install "litellm[proxy]"

install -m 0644 "$ROOT/scripts/deepseek_codex_callbacks.py" "$CODEX_HOME/deepseek_codex_callbacks.py"
install -m 0644 "$ROOT/examples/litellm-deepseek.yaml" "$CODEX_HOME/litellm-deepseek.yaml"
install -m 0755 "$ROOT/scripts/codex-deepseek-bridge" "$CODEX_HOME/bin/codex-deepseek-bridge"

if systemctl --user is-system-running >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  sed "s#{{CODEX_HOME}}#$CODEX_HOME#g" \
    "$ROOT/systemd/codex-deepseek-bridge.service" \
    > "$HOME/.config/systemd/user/codex-deepseek-bridge.service"
  systemctl --user daemon-reload
  systemctl --user import-environment DEEPSEEK_API_KEY
  systemctl --user enable --now codex-deepseek-bridge.service
else
  "$CODEX_HOME/bin/codex-deepseek-bridge" start
fi

echo "Installed Codex DeepSeek bridge files under $CODEX_HOME."
