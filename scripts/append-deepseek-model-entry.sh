#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
OUT="${1:-$CODEX_HOME/codex-models-with-deepseek.json}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to update the Codex model catalog." >&2
  exit 1
fi

base_catalog="$(mktemp)"
updated_catalog="$(mktemp)"
trap 'rm -f "$base_catalog" "$updated_catalog"' EXIT

codex debug models > "$base_catalog"

jq --slurpfile deepseek "$ROOT/examples/deepseek-model-entry.json" '
  .models = ([.models[] | select(.slug != "deepseek-v4-pro")] + [$deepseek[0]])
' "$base_catalog" > "$updated_catalog"

install -m 0644 "$updated_catalog" "$OUT"
echo "Wrote $OUT"
