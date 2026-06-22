# Troubleshooting

## DeepSeek model sent to OpenAI/ChatGPT provider

**Symptom:**

```
The 'deepseek-v4-pro' model is not supported when using Codex with a ChatGPT account.
```

**Cause:** Codex selected the DeepSeek model slug but `model_provider` is still
`"openai"`.

**Fix:** Use the profile so Codex switches both `model` and `model_provider`:

```bash
codex --profile deepseek-v4-pro
```

Do **not** fix this with only `codex --model deepseek-v4-pro`.  That changes
the model slug but leaves the provider on `"openai"`.

**Check:** Verify your profile contains both keys:

```toml
model = "moonbridge"
model_provider = "moonbridge"
```

## Missing API key

**Symptom:** DeepSeek returns `401 Unauthorized` or the bridge fails to start.

**Fix:** Set the environment variable:

```bash
export DEEPSEEK_API_KEY="sk-..."
```

And restart the bridge or the systemd service:

```bash
systemctl --user import-environment DEEPSEEK_API_KEY
systemctl --user restart codex-moonbridge.service
```

For reboot-safe startup, rerun the Moon Bridge installer after exporting the
key. It writes `~/.config/codex-deepseek/moonbridge.env` with mode `600`, and
the generated `~/.codex/bin/codex-moonbridge` launcher loads that file when the
service starts before your shell has exported the variable:

```bash
export DEEPSEEK_API_KEY="sk-..."
./scripts/install-moonbridge.sh
```

## Wrong provider selected

**Symptom:** Codex uses the OpenAI provider even when `deepseek-v4-pro` is
selected.

**Fix:**

1. Check the active profile: `codex --profile deepseek-v4-pro`
2. Inspect `~/.codex/deepseek-v4-pro.config.toml` and confirm
   `model_provider` points to `"moonbridge"` (or `"deepseek"` for LiteLLM).
3. Confirm the `[model_providers.<id>]` table defines a `base_url` pointing to
   the bridge.

## Moon Bridge not running

**Symptom:** Codex connection errors when using the DeepSeek profile.

**Fix:**

Check the systemd service:

```bash
systemctl --user status codex-moonbridge.service
journalctl --user -u codex-moonbridge.service -n 50
```

Or start it manually:

```bash
~/.codex/bin/codex-moonbridge
```

Verify the bridge is listening:

```bash
curl http://127.0.0.1:38440/v1/models
```

## LiteLLM fallback not running

**Symptom:** `codex --profile deepseek-v4-pro` fails to connect to
`127.0.0.1:4000`.

**Fix:**

Check the bridge:

```bash
~/.codex/bin/codex-deepseek-bridge status
~/.codex/bin/codex-deepseek-bridge logs 80
```

Start it if stopped:

```bash
~/.codex/bin/codex-deepseek-bridge start
```

## VS Code not using the wrapper

**Symptom:** DeepSeek works from the terminal but the VS Code model picker
shows the ChatGPT account error.

**Fix:**

1. Confirm `chatgpt.cliExecutable` is set to the wrapper path.
2. Confirm the file is executable: `ls -l ~/.codex/bin/codex-vscode-deepseek-bridge`
3. Reload the VS Code window: `Ctrl+Shift+P` -> "Developer: Reload Window".
4. Check the wrapper tests pass: `node ./scripts/test-vscode-deepseek-bridge.js`

## Permission errors on scripts

**Symptom:** `Permission denied` when running an installer.

**Fix:**

```bash
chmod +x scripts/install-moonbridge.sh
chmod +x scripts/install.sh
chmod +x scripts/append-deepseek-model-entry.sh
chmod +x scripts/codex-deepseek-bridge
```

## Model appears in picker but fails when selected

**Symptom:** DeepSeek V4 Pro shows in the VS Code model list, but selecting it
fails.

**Likely causes:**

1. The wrapper is not rewriting the request.  Check wrapper tests.
2. Moon Bridge is not running.  Check `systemctl --user status codex-moonbridge.service`.
3. The profile config is missing or incorrect.  Check `~/.codex/deepseek-v4-pro.config.toml`.

## GPT models stop working

**Symptom:** GPT threads fail after installing the DeepSeek setup.

**Likely causes:**

1. The base `~/.codex/config.toml` was overwritten.  Restore it from a backup
   or from `examples/config.toml`.
2. The DeepSeek profile was placed at `~/.codex/config.toml` instead of
   `~/.codex/deepseek-v4-pro.config.toml`.

**Fix:** Make sure the base config keeps GPT as default:

```toml
model = "gpt-5.5"
model_provider = "openai"
model_reasoning_effort = "xhigh"
```

Use `codex --profile gpt55` to reach GPT explicitly.

## Connector tool schema error

**Symptom:**

```
Invalid schema for function 'mcp__codex_apps__github'
```

**Cause:** The DeepSeek profile inherited app/connector tool schemas that
DeepSeek rejects.

**Fix:** Keep apps and connector plugins disabled in the DeepSeek profile:

```toml
[features]
apps = false

[plugins."gmail@openai-curated"]
enabled = false

[plugins."github@openai-curated"]
enabled = false

[plugins."google-drive@openai-curated"]
enabled = false
```

This is profile-scoped and does not affect GPT sessions.

## Strict config validation errors

**Symptom:** `codex --profile deepseek-v4-pro --strict-config` fails with
unrecognized key errors.

**Fix:** The installer removes keys that Codex 0.141.0 rejects (such as
`model_max_output_tokens`).  If you set up manually and see this error, remove
those keys from the profile.

## DeepSeek threads disappear after reboot

**Symptom:** After restarting your computer and reopening VS Code, only GPT
threads appear in the Codex thread list. DeepSeek threads are missing even
though they existed before the reboot.

**Cause:** Codex lists threads from the default provider. When the default
config uses the OpenAI provider, only OpenAI-managed threads appear. DeepSeek
threads, which are routed through the Moon Bridge provider, are stored locally
in the Codex state database but were not being merged into the thread list
response.

**Fix:** The VS Code bridge now intercepts thread-listing responses and merges
Moon Bridge threads from the local state database (`~/.codex/state_*.sqlite`).
Re-run the Moon Bridge installer to get the updated bridge:

```bash
cd /home/rrlab/codex_deepseek_integration
./scripts/install-moonbridge.sh
```

Then reload the VS Code window (Ctrl+Shift+P → Developer: Reload Window).

**Manual fix if the installer doesn't apply:**

```bash
cp /home/rrlab/codex_deepseek_integration/scripts/codex-vscode-deepseek-bridge.js \
   ~/.codex/bin/codex-vscode-deepseek-bridge
chmod +x ~/.codex/bin/codex-vscode-deepseek-bridge
```

Also ensure the default `~/.codex/config.toml` uses GPT as the default model:

```toml
model = "gpt-5.5"
model_provider = "openai"
model_reasoning_effort = "xhigh"
```
