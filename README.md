# Codex DeepSeek Integration

Run `deepseek-v4-pro` from OpenAI Codex by putting a Responses-compatible bridge
in front of DeepSeek and selecting the matching Codex custom provider.

DeepSeek's official Codex guide recommends Moon Bridge for this. This repository
documents that path and keeps the LiteLLM bridge as a fallback that was verified
locally.

This repository was checked with:

- Codex CLI `0.141.0`
- Go `1.26.4` for Moon Bridge builds
- Moon Bridge `8254b41`
- LiteLLM `1.89.2`
- DeepSeek API model `deepseek-v4-pro`
- `DEEPSEEK_API_KEY` provided by the environment

## Why a bridge is needed

Codex custom providers use the Responses wire API. DeepSeek exposes an
Anthropic-compatible endpoint for V4 and does not expose the same Codex-facing
`/v1/responses` behavior directly. A bridge provides `/v1/responses`, translates
Codex requests, and forwards them to DeepSeek.

DeepSeek's guide uses Moon Bridge because it has DeepSeek V4 support, exposes a
Responses endpoint, and can generate Codex `config.toml` plus
`models_catalog.json`. The LiteLLM fallback in this repo uses a small callback to
remove unsupported non-function tools before forwarding to DeepSeek.

## Correct setup

The safe setup is:

1. Keep your base `~/.codex/config.toml` on the built-in OpenAI provider, unless
   you want DeepSeek to be your default for every Codex session.
2. Run a Responses-compatible bridge. Prefer Moon Bridge, because it is the
   DeepSeek-documented Codex path.
3. Use a self-contained Codex profile that sets both `model` and
   `model_provider`.
4. Start DeepSeek sessions with the profile instead of only changing the model
   slug.

The model catalog only makes a model visible to Codex. It does not bind that
model to a provider. If Codex selects `deepseek-v4-pro` while
`model_provider` is still the default `openai`, ChatGPT-account auth rejects the
request before it ever reaches your bridge.

## The ChatGPT account error

If Codex shows this error:

```text
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

the active config selected the DeepSeek model slug but did not select the
DeepSeek provider. This is incomplete:

```toml
model = "deepseek-v4-pro"
```

Use both keys in the same active config layer:

```toml
model = "deepseek-v4-pro"
model_provider = "deepseek"
```

This follows OpenAI's Codex advanced configuration docs: custom providers are
defined in `model_providers.<id>`, and Codex must point `model_provider` at that
provider.

## Files

- `docs/moonbridge.md`: recommended Moon Bridge setup based on DeepSeek's guide.
- `docs/litellm-fallback.md`: fallback setup verified on this machine.
- `scripts/install-moonbridge.sh`: installs Go when needed, builds Moon Bridge,
  generates the Codex profile/catalog, and starts the user service.
- `scripts/deepseek_codex_callbacks.py`: LiteLLM fallback callback that strips
  unsupported non-function tools.
- `scripts/codex-deepseek-bridge`: LiteLLM fallback helper for starting,
  stopping, checking, and reading logs from the bridge.
- `scripts/install.sh`: installs the LiteLLM fallback bridge files and profile.
- `examples/litellm-deepseek.yaml`: LiteLLM proxy config.
- `examples/moonbridge-config.yml`: minimal Moon Bridge config for
  `deepseek-v4-pro`.
- `examples/moonbridge-codex-profile.config.toml`: Codex profile shape generated
  by Moon Bridge.
- `examples/config.toml`: conservative base Codex config that keeps GPT as the
  default.
- `examples/deepseek-v4-pro.config.toml`: self-contained Codex profile for the
  LiteLLM fallback.
- `examples/deepseek-default.config.toml`: optional LiteLLM fallback config for
  making DeepSeek the global default.
- `examples/gpt55.config.toml`: Codex profile for GPT-5.5.
- `examples/deepseek-model-entry.json`: DeepSeek metadata overlay for your
  Codex model catalog when using the LiteLLM fallback.
- `scripts/append-deepseek-model-entry.sh`: creates a Codex model catalog from
  your installed Codex, clones the current `gpt-5.5` model metadata, and
  adds/replaces the DeepSeek entry for the LiteLLM fallback.
- `systemd/codex-deepseek-bridge.service`: user service template.
- `systemd/codex-moonbridge.service`: user service template for Moon Bridge.

## Recommended: Moon Bridge

The automated path keeps GPT as the default Codex config, creates a separate
DeepSeek profile, and reads the DeepSeek key from `DEEPSEEK_API_KEY` at runtime
instead of storing it permanently in `~/.codex`.

```bash
export DEEPSEEK_API_KEY="sk-..."
./scripts/install-moonbridge.sh
```

The installer:

- Installs official Go `1.26.4` under `~/.local/go` if Go `1.25+` is missing.
- Clones Moon Bridge into `${CODEX_HOME:-$HOME/.codex}/moon-bridge`.
- Builds `${CODEX_HOME:-$HOME/.codex}/bin/moonbridge`.
- Writes `${CODEX_HOME:-$HOME/.codex}/bin/codex-moonbridge`, a launcher that
  creates a private runtime YAML from `DEEPSEEK_API_KEY`.
- Generates `${CODEX_HOME:-$HOME/.codex}/deepseek-v4-pro.config.toml` and
  `${CODEX_HOME:-$HOME/.codex}/models_catalog.json` with Moon Bridge's official
  generator.
- Removes generated profile keys unsupported by Codex `0.141.0`, disables
  apps/connectors only inside the DeepSeek profile, and keeps the base GPT
  profile unchanged.
- Installs and starts `codex-moonbridge.service` when user systemd is available.

Use it from VS Code or a terminal with:

```bash
codex --profile deepseek-v4-pro
codex exec --profile deepseek-v4-pro "Reply exactly: ok"
```

DeepSeek's official guide also supports a manual Moon Bridge setup:

```bash
git clone https://github.com/ZhiYi-R/moon-bridge.git
cd moon-bridge
```

Create a `config.yml` like `examples/moonbridge-config.yml`, set your
DeepSeek API key, and start Moon Bridge:

```bash
go run ./cmd/moonbridge --config config.yml
```

Moon Bridge listens on `127.0.0.1:38440` by default and exposes:

```text
http://127.0.0.1:38440/v1/responses
```

Generate Codex config and the catalog from the Moon Bridge directory:

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

Then launch Codex with that profile-style config by copying the generated file
to a profile name, for example:

```bash
cp "$CODEX_HOME_DIR/moonbridge.config.toml" "$CODEX_HOME_DIR/deepseek-v4-pro.config.toml"
codex --profile deepseek-v4-pro
```

The generated config uses `model_provider = "moonbridge"`,
`wire_api = "responses"`, and a generated `models_catalog.json`.

More detail: [docs/moonbridge.md](docs/moonbridge.md).

## Fallback: LiteLLM

Set your DeepSeek key in your shell environment:

```bash
export DEEPSEEK_API_KEY="sk-..."
```

Run the installer:

```bash
./scripts/install.sh
```

The installer copies bridge files under `${CODEX_HOME:-$HOME/.codex}`, installs
LiteLLM into `${CODEX_HOME}/litellm-venv`, and starts the user systemd service
when `systemctl --user` is available. It also creates:

- `$CODEX_HOME/deepseek-v4-pro.config.toml`
- `$CODEX_HOME/gpt55.config.toml`
- `$CODEX_HOME/codex-models-with-deepseek.json`

The LiteLLM fallback was verified locally with:

```bash
codex exec --profile deepseek-v4-pro --strict-config --ephemeral --json "Reply exactly: ok"
```

More detail: [docs/litellm-fallback.md](docs/litellm-fallback.md).

## Codex config rule

In your base config, keep GPT as the default if you want normal Codex sessions
to keep using your ChatGPT/OpenAI account:

```toml
model = "gpt-5.5"
model_provider = "openai"
model_reasoning_effort = "xhigh"
```

For the recommended Moon Bridge path, the generated
`$CODEX_HOME/deepseek-v4-pro.config.toml` should look like this shape:

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

[plugins."gmail@openai-curated"]
enabled = false

[plugins."github@openai-curated"]
enabled = false

[plugins."google-drive@openai-curated"]
enabled = false
```

`features.apps = false` is profile-scoped. GPT remains the default in
`~/.codex/config.toml`, and GPT keeps the existing app/plugin connector
functionality.

For the LiteLLM fallback, put this in
`$CODEX_HOME/deepseek-v4-pro.config.toml`:

```toml
model = "deepseek-v4-pro"
model_provider = "deepseek"
model_catalog_json = "/home/you/.codex/codex-models-with-deepseek.json"
model_context_window = 1000000
model_reasoning_effort = "xhigh"
model_reasoning_summary = "none"

[model_providers.deepseek]
name = "DeepSeek via LiteLLM"
base_url = "http://127.0.0.1:4000/v1"
wire_api = "responses"
```

Then use:

```bash
codex --profile deepseek-v4-pro
codex exec --profile deepseek-v4-pro "Reply exactly: ok"
```

If you intentionally want DeepSeek as the global default, use both keys in
`~/.codex/config.toml`:

```toml
model = "deepseek-v4-pro"
model_provider = "deepseek"
```

and include the `[model_providers.deepseek]` table from the profile example.

To keep GPT easy to reach, put this in `$CODEX_HOME/gpt55.config.toml`:

```toml
model_provider = "openai"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
```

Then use:

```bash
codex --profile gpt55
codex exec --profile gpt55 "Reply exactly: ok"
```

## Model catalog rule

Codex's model catalog is metadata. It helps Codex know the context window,
reasoning levels, display name, and required internal instruction fields for
`deepseek-v4-pro`, but it is not enough to route requests to DeepSeek.

Moon Bridge can generate a complete `models_catalog.json` for Codex. If you use
the LiteLLM fallback, generate your current catalog from your installed Codex,
clone the installed `gpt-5.5` metadata, and overlay
`examples/deepseek-model-entry.json`.

Use the helper:

```bash
./scripts/append-deepseek-model-entry.sh ~/.codex/codex-models-with-deepseek.json
```

Then set:

```toml
model_catalog_json = "/home/you/.codex/codex-models-with-deepseek.json"
```

The exact built-in model objects can change, and Codex rejects entries that are
missing required fields such as `base_instructions`. That is why the helper
starts from your own `codex debug models` output instead of copying an old full
catalog.

Avoid this pattern:

```bash
codex --model deepseek-v4-pro
```

That changes the model only. It does not necessarily change `model_provider`,
which is the reason the ChatGPT-account error happens.

## Verify

Check Moon Bridge:

```bash
curl http://127.0.0.1:38440/v1/models
curl http://127.0.0.1:38440/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"moonbridge","input":"Say hello in one short sentence.","max_output_tokens":1024}'
```

Check the LiteLLM fallback bridge:

```bash
~/.codex/bin/codex-deepseek-bridge status
~/.codex/bin/codex-deepseek-bridge logs 80
```

Check Codex through the DeepSeek profile:

```bash
codex exec --profile deepseek-v4-pro --strict-config --ephemeral --json "Reply exactly: ok"
```

Check GPT still works:

```bash
codex exec --profile gpt55 --strict-config --ephemeral --json "Reply exactly: ok"
```

If DeepSeek returns an upstream schema error for a connector tool, confirm the
DeepSeek profile contains:

```toml
[features]
apps = false
```

The base GPT config can still keep apps/connectors enabled.

## References

- OpenAI Codex advanced configuration: profiles are separate
  `$CODEX_HOME/profile-name.config.toml` files, and custom providers require
  pointing `model_provider` at the provider id.
- OpenAI Codex configuration reference: `model_provider` defaults to `openai`;
  `model_catalog_json` only loads model metadata; custom providers live under
  `model_providers.<id>`.
- DeepSeek Codex integration guide: DeepSeek recommends Moon Bridge as the
  forwarding layer for Codex and DeepSeek V4.
- Moon Bridge: exposes `/v1/responses`, supports DeepSeek V4, and generates
  Codex config/catalog files.
- LiteLLM Responses API docs: LiteLLM exposes an OpenAI-compatible
  `/v1/responses` endpoint for the fallback path.
- LiteLLM DeepSeek provider docs: DeepSeek models use the `deepseek/` provider
  prefix and `DEEPSEEK_API_KEY`.

## Community check

I found DeepSeek's official Moon Bridge guide and public examples of Codex with
LiteLLM/proxy providers. I did not find this exact LiteLLM fallback documented
elsewhere. See `docs/community-check.md`.
