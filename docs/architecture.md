# Architecture

## Request flow

```
User
  |
  v
Codex CLI  or  VS Code Codex extension
  |                |
  |                v
  |           codex-vscode-deepseek-bridge (wrapper)
  |                |
  v                v
Profile: deepseek-v4-pro.config.toml
  model_provider = "moonbridge"  (or "deepseek" for LiteLLM)
  base_url = http://127.0.0.1:38440/v1  (or :4000/v1)
  |
  v
Moon Bridge  or  LiteLLM fallback
  - Exposes /v1/responses
  - Translates Codex requests
  - Forwards to DeepSeek API
  |
  v
DeepSeek API  (api.deepseek.com)
  |
  v
Response back through the same chain -> Codex -> User
```

## Normal GPT traffic is untouched

When the base `~/.codex/config.toml` keeps `model_provider = "openai"` and the
default model on GPT, normal sessions do not pass through Moon Bridge or
LiteLLM:

```
User -> Codex CLI/VS Code -> OpenAI API -> Response -> User
```

GPT threads in VS Code also bypass the wrapper entirely. The wrapper only
intervenes when a new thread selects the DeepSeek model.

## Why a bridge is required

Codex custom providers use the Responses wire API.  DeepSeek exposes an
Anthropic-compatible endpoint for V4 and does not provide the Codex-facing
`/v1/responses` endpoint directly.  A bridge sits between Codex and DeepSeek
and:

- Exposes `/v1/responses` in the format Codex expects.
- Translates Codex requests to match what the DeepSeek API accepts.
- Translates DeepSeek responses back into the shape Codex understands.

Without a bridge, Codex cannot talk to DeepSeek at all.

## Two bridge options

**Moon Bridge (recommended):** DeepSeek's official Codex guide recommends this
path.  Moon Bridge is a Go proxy with built-in DeepSeek V4 support, a Responses
endpoint, and the ability to generate `config.toml` and `models_catalog.json`
for Codex.

**LiteLLM (fallback):** A Python proxy that exposes a `/v1/responses` endpoint
through its proxy server.  Uses a small callback to strip unsupported
non-function tools before forwarding to DeepSeek.  Use this path when Moon
Bridge cannot be run.

## The provider routing problem

Simply adding a DeepSeek model name to Codex's model catalog is not enough.
Codex's `model_provider` setting binds the model to a specific provider
configuration.  If `model_provider` remains `"openai"` (the default), Codex
sends the request to the ChatGPT/OpenAI endpoint, which rejects an unknown
model slug.

This repo solves that by making the provider selection explicit and
profile-based:

- A separate Codex profile sets **both** `model` and `model_provider` to the
  bridge provider.
- GPT stays untouched in the base config.
- Switching between GPT and DeepSeek is a single `--profile` flag.
