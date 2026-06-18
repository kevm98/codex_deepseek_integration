# LiteLLM Fallback

This fallback was verified locally with Codex CLI `0.141.0` and LiteLLM
`1.89.2`.

Use Moon Bridge first when possible because DeepSeek documents that path for
Codex. Use this fallback when you cannot run Moon Bridge and want a local
Responses-compatible proxy.

## Install

```bash
export DEEPSEEK_API_KEY="sk-..."
./scripts/install.sh
```

The installer creates:

- `$CODEX_HOME/litellm-venv`
- `$CODEX_HOME/litellm-deepseek.yaml`
- `$CODEX_HOME/deepseek_codex_callbacks.py`
- `$CODEX_HOME/codex-models-with-deepseek.json`
- `$CODEX_HOME/deepseek-v4-pro.config.toml`
- `$CODEX_HOME/gpt55.config.toml`

It starts a user systemd service when available, otherwise it starts the bridge
with the helper script.

## Why the callback exists

Codex may send non-function tool entries. DeepSeek's upstream endpoint accepts
standard function tools, so `scripts/deepseek_codex_callbacks.py` removes
unsupported non-function tools before the request is forwarded.

## Verify

```bash
~/.codex/bin/codex-deepseek-bridge status
codex exec --profile deepseek-v4-pro --strict-config --ephemeral --json "Reply exactly: ok"
codex exec --profile gpt55 --strict-config --ephemeral --json "Reply exactly: ok"
```

## Avoid

Avoid changing only the model:

```bash
codex --model deepseek-v4-pro
```

That can leave `model_provider = "openai"` active and trigger the ChatGPT-account
model-support error.
