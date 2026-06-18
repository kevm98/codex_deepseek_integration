# Security

## Do not commit API keys

Never commit a real `.env` file or hardcode API keys in scripts or config files.
Use `.env.example` as a template and copy it to `.env` for local use.
Make sure `.env` is in your `.gitignore`.

## Use environment variables

Set `DEEPSEEK_API_KEY` in your shell environment, not in config files:

```bash
export DEEPSEEK_API_KEY="your_api_key_here"
```

The Moon Bridge launcher (`codex-moonbridge`) reads the key from the environment
at startup and writes it to a private runtime file under `$XDG_RUNTIME_DIR` with
`umask 077`. The key is never stored in the persistent Moon Bridge checkout.

## Keep API keys out of shell history

When exporting the key interactively, consider using a read-prompt approach or
clearing history afterward:

```bash
read -s -p "DeepSeek API key: " DEEPSEEK_API_KEY
export DEEPSEEK_API_KEY
```

On systems where `HISTCONTROL=ignorespace` is set, prefix the command with a
space to avoid recording it in shell history.

## Keep tokens out of logs

Bridge processes may log request data. Review bridge logging configurations
before running in sensitive environments. The VS Code wrapper writes operational
messages to stderr, not model inputs or outputs.

## Review shell scripts before running

All scripts in this repo are open for inspection. Read them before executing,
especially installers that fetch code from external Git repositories or modify
your `~/.codex` directory.

## This is an unofficial integration

This repo is not an official OpenAI or DeepSeek project. It is a community
helper repo that packages configuration, wrapper scripts, and bridge setup
instructions.

## Users are responsible for

- API costs incurred through your DeepSeek account.
- Account security and key rotation on the DeepSeek platform.
- Ensuring scripts are compatible with your system and Codex version.
