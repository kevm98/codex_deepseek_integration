# Codex DeepSeek Integration

Run `deepseek-v4-pro` from OpenAI Codex by putting LiteLLM in front of
DeepSeek and configuring Codex to use a custom Responses-compatible provider.

This repository documents a working setup tested with:

- Codex CLI `0.141.0`
- LiteLLM `1.89.2`
- DeepSeek API model `deepseek-v4-pro`
- `DEEPSEEK_API_KEY` provided by the environment

## Why a bridge is needed

Codex custom providers use the Responses wire API. DeepSeek exposes an
OpenAI-compatible Chat Completions API, not a native `/responses` endpoint.
LiteLLM provides the `/v1/responses` endpoint Codex needs and forwards the
request to DeepSeek.

One extra translation is needed: Codex sends a `custom` tool type for some
agent actions, while DeepSeek's chat endpoint accepts standard `function` tools.
The callback in `scripts/deepseek_codex_callbacks.py` removes only unsupported
non-function tools before LiteLLM forwards the request upstream.

## The ChatGPT account error

If Codex shows this error:

```text
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

the usual cause is:

```toml
model = "deepseek-v4-pro"
```

without:

```toml
model_provider = "deepseek"
```

Codex defaults `model_provider` to `openai`. With ChatGPT sign-in, that makes
Codex ask the ChatGPT/OpenAI backend for a DeepSeek model slug. The request never
reaches your local LiteLLM bridge.

## Files

- `scripts/deepseek_codex_callbacks.py`: LiteLLM callback that strips unsupported
  non-function tools.
- `scripts/codex-deepseek-bridge`: helper for starting, stopping, checking, and
  reading logs from the bridge.
- `scripts/install.sh`: installs LiteLLM, bridge files, and an optional user
  systemd service.
- `examples/litellm-deepseek.yaml`: LiteLLM proxy config.
- `examples/config.toml`: Codex config using DeepSeek as the default.
- `examples/deepseek-v4-pro.config.toml`: Codex profile for DeepSeek.
- `examples/gpt55.config.toml`: Codex profile for GPT-5.5.
- `examples/deepseek-model-entry.json`: model catalog entry to append to your
  Codex model catalog.
- `scripts/append-deepseek-model-entry.sh`: creates a Codex model catalog from
  your installed Codex and adds/replaces the DeepSeek entry.
- `systemd/codex-deepseek-bridge.service`: user service template.

## Install

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
when `systemctl --user` is available.

## Codex config

Add the provider and select it when DeepSeek is active:

```toml
model = "deepseek-v4-pro"
model_provider = "deepseek"
model_reasoning_effort = "xhigh"
model_reasoning_summary = "none"
model_catalog_json = "/home/you/.codex/codex-models-with-deepseek.json"

[model_providers.deepseek]
name = "DeepSeek via LiteLLM"
base_url = "http://127.0.0.1:4000/v1"
wire_api = "responses"
```

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

For DeepSeek as a profile instead of the default, put this in
`$CODEX_HOME/deepseek-v4-pro.config.toml`:

```toml
model_provider = "deepseek"
model = "deepseek-v4-pro"
model_context_window = 1000000
model_reasoning_effort = "xhigh"
model_reasoning_summary = "none"
```

Then use:

```bash
codex --profile deepseek-v4-pro
codex exec --profile deepseek-v4-pro "Reply exactly: ok"
```

## Model catalog

Codex's model picker reads model metadata from the catalog. Generate your current
catalog from your installed Codex and append `examples/deepseek-model-entry.json`.

Use the helper:

```bash
./scripts/append-deepseek-model-entry.sh ~/.codex/codex-models-with-deepseek.json
```

Then set:

```toml
model_catalog_json = "/home/you/.codex/codex-models-with-deepseek.json"
```

The exact built-in model objects can change, so prefer starting from your own
`codex debug models` output and adding the DeepSeek entry instead of copying an
old full catalog.

## Verify

Check the bridge:

```bash
~/.codex/bin/codex-deepseek-bridge status
~/.codex/bin/codex-deepseek-bridge logs 80
```

Check Codex through the default DeepSeek config:

```bash
codex exec --strict-config --ephemeral --json "Reply exactly: ok"
```

Check GPT still works:

```bash
codex exec --profile gpt55 --strict-config --ephemeral --json "Reply exactly: ok"
```

## References

- OpenAI Codex advanced configuration: custom providers require selecting
  `model_provider`, and `wire_api = "responses"` is the supported custom
  provider wire API.
- OpenAI Codex auth docs: ChatGPT sign-in and API-key sign-in are separate auth
  paths; third-party provider keys should use provider config or a local bridge.
- LiteLLM Responses API docs: LiteLLM exposes an OpenAI-compatible
  `/v1/responses` endpoint.
- LiteLLM DeepSeek provider docs: DeepSeek models use the `deepseek/` provider
  prefix and `DEEPSEEK_API_KEY`.

## Community check

I found public examples of people using Codex with LiteLLM or proxy providers,
but not this exact `deepseek-v4-pro` + LiteLLM Responses bridge + custom-tool
filter fix. See `docs/community-check.md`.
