# Moon Bridge Setup

DeepSeek's official Codex guide recommends Moon Bridge as the forwarding layer
between Codex and DeepSeek V4.

Moon Bridge is a Go proxy that exposes an OpenAI Responses-compatible endpoint
at `/v1/responses`, translates requests, routes them to DeepSeek, and can
generate Codex `config.toml` plus `models_catalog.json`.

## Requirements

- Node.js 18+
- Go 1.25+
- Codex CLI
- DeepSeek API key

This machine did not have Go installed during validation, so I could inspect the
Moon Bridge source and DeepSeek guide but could not run Moon Bridge locally.

## Configure Moon Bridge

Clone Moon Bridge:

```bash
git clone https://github.com/ZhiYi-R/moon-bridge.git
cd moon-bridge
```

Create `config.yml` using `examples/moonbridge-config.yml` from this repo and
replace `sk-your-deepseek-api-key`.

Start it:

```bash
go run ./cmd/moonbridge --config config.yml
```

Moon Bridge should listen on:

```text
http://127.0.0.1:38440/v1/responses
```

## Generate Codex Files

From the Moon Bridge checkout:

```bash
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME_DIR"
cp "$CODEX_HOME_DIR/config.toml" "$CODEX_HOME_DIR/config.toml.bak" 2>/dev/null || true

MODEL="$(go run ./cmd/moonbridge --config config.yml --print-codex-model)"
go run ./cmd/moonbridge \
  --config config.yml \
  --print-codex-config "$MODEL" \
  --codex-base-url "http://127.0.0.1:38440/v1" \
  --codex-home "$CODEX_HOME_DIR" \
  > "$CODEX_HOME_DIR/moonbridge.config.toml"
```

Moon Bridge writes:

- `moonbridge.config.toml`: Codex provider config using
  `model_provider = "moonbridge"` and `wire_api = "responses"`.
- `models_catalog.json`: Codex model metadata including context window,
  reasoning levels, and tool support.

Use it as a profile:

```bash
cp "$CODEX_HOME_DIR/moonbridge.config.toml" "$CODEX_HOME_DIR/deepseek-v4-pro.config.toml"
codex --profile deepseek-v4-pro
```

## Verify

```bash
curl http://127.0.0.1:38440/v1/models
curl http://127.0.0.1:38440/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"moonbridge","input":"Say hello in one short sentence.","max_output_tokens":1024}'
```

When Codex sends a message, the Moon Bridge terminal should log
`POST /v1/responses`.

## Common Failure

This error:

```text
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

means Codex selected the DeepSeek model slug while the active provider remained
`openai`. The Moon Bridge generated config avoids that by setting
`model_provider = "moonbridge"`.
