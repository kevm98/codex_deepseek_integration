# Codex DeepSeek Integration

## Summary

`codex_deepseek_integration` is a practical bridge and tooling repo for running
DeepSeek V4 Pro inside OpenAI Codex CLI and the VS Code Codex model picker.

It solves the provider-routing problem that happens when Codex sees a DeepSeek
model name but still tries to send the request through the default
OpenAI/ChatGPT provider.

The goal is to let developers use DeepSeek and GPT models side by side without
breaking normal Codex usage.

## What this repo is

A reproducible developer setup for running DeepSeek V4 Pro inside OpenAI Codex
CLI and VS Code while keeping GPT models working normally.

This is a configuration, bridge, and wrapper repository that solves the missing
compatibility layer between Codex's current provider setup and the DeepSeek API.

It provides:

- A working DeepSeek V4 Pro setup for Codex CLI
- A separate DeepSeek provider/profile configuration
- Moon Bridge-based routing as the recommended path
- VS Code Codex model picker support
- A wrapper that preserves normal GPT/OpenAI usage
- LiteLLM fallback support
- Example configs and scripts
- Troubleshooting notes for common provider/model mismatch errors

DeepSeek publishes official guidance for using Moon Bridge with Codex. This repo
packages that workflow into a more practical, documented, developer-friendly
setup.

## What this repo is not

This repo is not:

- An official OpenAI project
- An official DeepSeek project
- A new language model
- A fork of Codex
- A replacement for GPT models
- A guarantee that every Codex feature will work with every DeepSeek-compatible endpoint

## Why this exists

Codex supports custom providers, but simply adding a DeepSeek model name to the
catalog is not enough. If the provider routing is wrong, Codex may still try to
send the DeepSeek model request through the default OpenAI/ChatGPT provider,
which causes errors.

## What problem it solves

This repo provides a reproducible setup that solves:

- DeepSeek model selection inside Codex
- Provider routing mismatch (the "ChatGPT account" error)
- VS Code model picker usability
- Keeping GPT and DeepSeek side by side
- Avoiding manual config confusion
- Providing a fallback path using LiteLLM

## Architecture overview

See [docs/architecture.md](docs/architecture.md) for the full flow diagram.
Here is the short version:

```
User
  ↓
Codex CLI / VS Code Codex
  ↓
Codex profile or VS Code wrapper
  ↓
Moon Bridge or LiteLLM fallback
  ↓
DeepSeek API
  ↓
Response back to Codex
```

The key idea:

- DeepSeek requests should be routed through the DeepSeek provider or bridge.
- GPT/OpenAI requests remain on the normal OpenAI/Codex route.
- The wrapper should not break normal GPT usage.

## Features

- Codex CLI profile for DeepSeek V4 Pro with one-command switching
- VS Code model picker integration via a transparent wrapper
- GPT models continue to work normally alongside DeepSeek
- Moon Bridge integration (DeepSeek's recommended Codex path)
- LiteLLM fallback for environments where Moon Bridge cannot run
- Automated installation with Go toolchain bootstrapping
- systemd user services for persistent bridge processes
- API key kept in environment variables, not stored in config files

## Repository structure

```
.
├── README.md
├── LICENSE
├── .gitignore
├── .env.example
├── docs/
│   ├── architecture.md
│   ├── moonbridge-setup.md
│   ├── vscode-setup.md
│   ├── litellm-fallback.md
│   ├── troubleshooting.md
│   ├── security.md
│   └── community-check.md
├── examples/
│   ├── codex-config-moonbridge.example.toml
│   ├── codex-config-litellm.example.toml
│   ├── vscode-settings.example.json
│   └── env.example
├── scripts/
│   ├── install-moonbridge.sh
│   ├── install-litellm.sh
│   ├── codex-deepseek-wrapper.sh
│   ├── test-deepseek-codex.sh
│   └── verify-setup.sh
└── systemd/
    ├── moonbridge.service
    └── litellm.service
```

## Requirements

- Codex CLI (tested with 0.141.0)
- Node.js 18+ (for the VS Code wrapper)
- DeepSeek API key
- For Moon Bridge: Go 1.25+ (auto-installed by the installer if missing)
- For LiteLLM: Python 3 and pip

## Quick start

```bash
# Get your DeepSeek API key from the DeepSeek platform.
# Set it in your environment:
export DEEPSEEK_API_KEY="your_api_key_here"

# Run the Moon Bridge installer (recommended):
./scripts/install-moonbridge.sh

# Test it:
codex exec --profile deepseek-v4-pro "Reply exactly: ok"
```

## DeepSeek API key setup

Get your API key from the DeepSeek platform and set it in your environment:

```bash
export DEEPSEEK_API_KEY="your_api_key_here"
```

Never commit your API key. Use environment variables or a `.env` file.
Copy `.env.example` to `.env` and fill in your key, but never commit `.env`.

## Recommended setup: Moon Bridge

Moon Bridge is the recommended path. DeepSeek's official Codex guide recommends
it as the forwarding layer between Codex and DeepSeek V4.

See [docs/moonbridge-setup.md](docs/moonbridge-setup.md) for the full guide.

The automated installer keeps GPT as the default, creates a separate DeepSeek
profile, and reads the key from the environment at runtime:

```bash
export DEEPSEEK_API_KEY="your_api_key_here"
./scripts/install-moonbridge.sh
```

The installer:

- Installs Go 1.26.4 under `~/.local/go` if Go 1.25+ is missing.
- Clones Moon Bridge into `~/.codex/moon-bridge`.
- Builds `~/.codex/bin/moonbridge`.
- Writes `~/.codex/bin/codex-moonbridge`, a launcher that creates a private
  runtime config from `DEEPSEEK_API_KEY`.
- Generates `~/.codex/deepseek-v4-pro.config.toml` and
  `~/.codex/models_catalog.json`.
- Installs `~/.codex/bin/codex-vscode-deepseek-bridge` for VS Code.
- Installs and starts `codex-moonbridge.service` when user systemd is available.

To also configure VS Code automatically:

```bash
CONFIGURE_VSCODE=1 ./scripts/install-moonbridge.sh
```

## Terminal usage

With the DeepSeek profile:

```bash
codex --profile deepseek-v4-pro
codex exec --profile deepseek-v4-pro "Reply exactly: ok"
```

Switch back to GPT:

```bash
codex --profile gpt55
codex exec --profile gpt55 "Reply exactly: ok"
```

The base config (`~/.codex/config.toml`) should keep GPT as the default so
`codex` without a profile uses your normal ChatGPT/OpenAI account:

```toml
model = "gpt-5.5"
model_provider = "openai"
model_reasoning_effort = "xhigh"
```

## VS Code usage

See [docs/vscode-setup.md](docs/vscode-setup.md) for the full setup guide.

After installing the wrapper and reloading the VS Code window, start a new
Codex thread and choose **DeepSeek V4 Pro** from the model picker. Existing
GPT threads stay on GPT.

## How the wrapper works

The VS Code Codex extension starts `codex app-server` through
`chatgpt.cliExecutable`. The wrapper (`scripts/codex-vscode-deepseek-bridge.js`):

1. Starts the real app-server with a merged model catalog so GPT and DeepSeek
   models appear together.
2. Passes GPT requests through unchanged.
3. Rewrites DeepSeek thread starts to use the Moon Bridge route model and
   injects the correct provider config.

## LiteLLM fallback

LiteLLM is a fallback path, not the primary recommended path. Use it when you
cannot run Moon Bridge and need a local Responses-compatible proxy.

See [docs/litellm-fallback.md](docs/litellm-fallback.md) for full setup
instructions, known limitations, and common errors.

## Verification

Run the verification script to confirm everything is wired correctly:

```bash
./scripts/verify-setup.sh
```

You can also manually verify Moon Bridge is responding:

```bash
curl http://127.0.0.1:38440/v1/models
curl http://127.0.0.1:38440/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"moonbridge","input":"Say hello in one short sentence.","max_output_tokens":1024}'
```

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for a full list of
common errors, likely causes, and fixes in table form, plus debugging commands.

## Security notes

See [docs/security.md](docs/security.md) for security guidance.

## Limitations

- This is an unofficial helper repo.
- Codex configuration behavior may change across versions.
- DeepSeek-compatible endpoints may not support every Codex feature.
- Tool/function calling compatibility may require bridge-side fixes.
- Users must provide their own DeepSeek API key.

## Roadmap

- Add screenshots for VS Code model picker setup
- Add a one-command setup script
- Add automated config validation
- Add more examples for different Codex versions
- Add CI checks for Markdown formatting and shell script linting

## Project summary for sharing

I built an open-source helper repo that makes it easier to run DeepSeek V4 Pro
inside OpenAI Codex CLI and VS Code.

The main challenge was not just calling the DeepSeek API, but routing the model
through the correct provider or bridge without breaking normal GPT usage.

This repo packages the configuration, wrapper, Moon Bridge setup, LiteLLM
fallback, and troubleshooting notes into a reproducible developer workflow.

## Contributing

Contributions are welcome. This is a community helper repo. Please open an issue
or pull request on GitHub.

## License

MIT -- see [LICENSE](LICENSE).
