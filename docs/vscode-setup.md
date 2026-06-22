# VS Code Codex model picker setup

The OpenAI Codex VS Code extension starts `codex app-server` through the
`chatgpt.cliExecutable` setting.  The app-server model list has model ids,
but model-list items do not carry a provider id.  That is why adding
`deepseek-v4-pro` to a catalog can produce:

```
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

This repo provides a Node.js wrapper that intercepts the app-server traffic
and injects the correct provider routing for DeepSeek.

## What the wrapper does

The wrapper (`scripts/codex-vscode-deepseek-bridge.js`) does three things:

1. Starts the real VS Code-bundled Codex app-server with a temporary merged
   model catalog so GPT models and DeepSeek V4 Pro appear together.
2. Leaves normal GPT requests untouched, preserving existing history and
   provider settings.
3. Rewrites DeepSeek thread starts from `deepseek-v4-pro` to the Moon Bridge
   route model `moonbridge` and injects the correct provider config.

## Installation

### Automated (recommended)

Run the Moon Bridge installer with the VS Code flag:

```bash
CONFIGURE_VSCODE=1 ./scripts/install-moonbridge.sh
```

This installs the wrapper to `~/.codex/bin/codex-vscode-deepseek-bridge` and
sets `chatgpt.cliExecutable` in VS Code user settings.

### Manual

Install the wrapper:

```bash
mkdir -p ~/.codex/bin
cp scripts/codex-vscode-deepseek-bridge.js ~/.codex/bin/codex-vscode-deepseek-bridge
chmod 700 ~/.codex/bin/codex-vscode-deepseek-bridge
```

Then update VS Code user settings (`~/.config/Code/User/settings.json`):

```json
{
  "chatgpt.cliExecutable": "/home/you/.codex/bin/codex-vscode-deepseek-bridge"
}
```

## Usage

After changing `chatgpt.cliExecutable`, **reload the VS Code window**
(`Ctrl+Shift+P` -> "Developer: Reload Window").

Start a new Codex thread and choose **DeepSeek V4 Pro** from the model picker.
Existing GPT threads keep using the OpenAI provider.

To switch back to GPT, create a new thread and select a GPT model.

## How to verify

The wrapper includes unit tests:

```bash
node ./scripts/test-vscode-deepseek-bridge.js
```

All tests should pass.

To verify end-to-end, start a VS Code Codex session with DeepSeek V4 Pro
selected and send a simple prompt like "Reply exactly: ok".  If you get a
response, the routing is working.

## How the wrapper rewrites requests

When a new thread selects `deepseek-v4-pro`:

| Before wrapper                         | After wrapper                          |
|----------------------------------------|----------------------------------------|
| `model: "deepseek-v4-pro"`             | `model: "moonbridge"`                  |
| (no modelProvider set)                 | `modelProvider: "moonbridge"`          |
| (default config)                       | Config with Moon Bridge provider       |
| (apps may be enabled)                  | `features.apps = false`                |
| (connector plugins enabled)            | Connector plugins disabled             |

GPT model selections pass through unchanged.

## Common issues

**Model does not appear in the picker:** Make sure `install-moonbridge.sh` ran
successfully and generated `~/.codex/models_catalog.json`.  Reload the VS Code
window.  If you pulled a newer version of this repo, rerun the installer so
VS Code uses the updated wrapper under `~/.codex/bin`.

**DeepSeek selected but fails with ChatGPT account error:** The wrapper may not
be active.  Check that `chatgpt.cliExecutable` points to the correct wrapper
path and that the file is executable.

**GPT models stop working:** The wrapper checks the model slug.  If your GPT
model slug is not `gpt-5.5`, update the reference in your GPT profile
(`~/.codex/gpt55.config.toml`).
