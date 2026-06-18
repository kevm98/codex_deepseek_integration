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
- DeepSeek API key in `DEEPSEEK_API_KEY`

The installer in this repo installs official Go `1.26.4` locally when Go
`1.25+` is missing.

This setup was verified with Codex CLI `0.141.0`, Go `1.26.4`, and Moon Bridge
commit `8254b41`.

## Automated Local Setup

From this repository:

```bash
export DEEPSEEK_API_KEY="sk-..."
./scripts/install-moonbridge.sh
```

The script keeps your existing `~/.codex/config.toml` in place, so GPT remains
the default for normal Codex sessions. It writes a separate profile:

```text
~/.codex/deepseek-v4-pro.config.toml
```

and a generated catalog:

```text
~/.codex/models_catalog.json
```

It also writes:

```text
~/.codex/bin/codex-moonbridge
~/.codex/bin/codex-vscode-deepseek-bridge
~/.codex/bin/moonbridge
~/.config/systemd/user/codex-moonbridge.service
```

`codex-moonbridge` creates a private runtime YAML under
`${XDG_RUNTIME_DIR:-/tmp}/codex-moonbridge` from `DEEPSEEK_API_KEY`. This avoids
storing the DeepSeek secret in the repo or in the persistent Moon Bridge
checkout.

The generated Codex profile is adjusted for this Codex version:

- `model_max_output_tokens` is removed because Codex `0.141.0` rejects it in
  strict config mode.
- Moon Bridge's optional DeepWiki MCP block is removed to keep the profile
  focused on DeepSeek.
- `features.apps = false` and connector plugin disables are added only to this
  profile because DeepSeek rejects at least one inherited connector tool schema
  that GPT accepts.
- `model_reasoning_summary = "none"` and
  `model_supports_reasoning_summaries = false` are added for compatibility with
  Codex's current config surface. Moon Bridge's DeepSeek V4 extension may still
  emit non-fatal reasoning-summary log lines while preserving DeepSeek thinking
  history.

Use the profile:

```bash
codex --profile deepseek-v4-pro
codex exec --profile deepseek-v4-pro --strict-config --ephemeral --json "Reply exactly: ok"
```

If VS Code was already open, reload the VS Code window after installing so the
Codex extension sees the updated user-level profile and model catalog.

Expected profile shape:

```toml
model = "moonbridge"
model_provider = "moonbridge"
model_context_window = 1000000
model_reasoning_summary = "none"
model_supports_reasoning_summaries = false
model_catalog_json = "/home/you/.codex/models_catalog.json"

[model_providers.moonbridge]
name = "Moon Bridge"
base_url = "http://127.0.0.1:38440/v1"
wire_api = "responses"

[features]
apps = false
```

## VS Code Model Picker

The CLI profile above is enough for terminal Codex usage, but the VS Code Codex
extension starts `codex app-server` and gets model choices from the app-server
model list. That list does not include provider ids per model, so a plain
`deepseek-v4-pro` catalog entry can still be sent to the default OpenAI provider
and fail with:

```text
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

Use the wrapper installed by the script:

```json
{
  "chatgpt.cliExecutable": "/home/you/.codex/bin/codex-vscode-deepseek-bridge"
}
```

The wrapper preserves normal GPT app-server traffic, adds DeepSeek to the model
list, and injects `modelProvider = "moonbridge"` only when a new DeepSeek thread
is started. To let the installer update VS Code user settings automatically,
run:

```bash
CONFIGURE_VSCODE=1 ./scripts/install-moonbridge.sh
```

Then reload the VS Code window and start a new Codex thread with `DeepSeek V4
Pro` selected. Existing GPT conversations keep using the OpenAI provider.

## Configure Moon Bridge

Manual setup follows DeepSeek's guide.

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

If `curl` is not installed, use Node's built-in `fetch`:

```bash
node -e 'fetch("http://127.0.0.1:38440/v1/models").then(r => r.text()).then(console.log)'
```

## Common Failure

This error:

```text
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

means Codex selected the DeepSeek model slug while the active provider remained
`openai`. The Moon Bridge generated config avoids that by setting
`model_provider = "moonbridge"`.

Do not fix this by only running:

```bash
codex --model deepseek-v4-pro
```

That changes the model slug only. Use the profile so Codex switches both
`model` and `model_provider` together.

## Connector Schema Failure

This error means Codex inherited an app/connector tool schema that DeepSeek
rejects:

```text
Invalid schema for function 'mcp__codex_apps__github'
```

Keep apps/connectors disabled in the DeepSeek profile:

```toml
[features]
apps = false
```

This does not disable apps/connectors for GPT when your base
`~/.codex/config.toml` still has them enabled.
