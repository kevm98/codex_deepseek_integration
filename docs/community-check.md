# Community Check

I checked for prior public work before documenting this setup.

## What appears to exist

Public GitHub search shows related examples of people using Codex with LiteLLM
or provider proxies, including:

- `keijiro/dotfiles` with a `codex-litellm` helper.
- `jsontype/syntax` notes for Codex with LiteLLM.
- `baskduf/FableCodex` with an example LiteLLM Codex config.
- `aws-samples/sample-openai-on-aws` with Codex and LiteLLM gateway docs.
- `LiteLLM-Labs/litellm-agent-control-plane` with Codex-related LiteLLM code.

Those are useful confirmation that Codex + LiteLLM is a real pattern.

## What I did not find

I did not find a public write-up for this exact combination:

- Codex custom model catalog entry for `deepseek-v4-pro`.
- Codex custom provider pointed at a local LiteLLM `/v1/responses` bridge.
- LiteLLM DeepSeek upstream configured as `deepseek/deepseek-v4-pro`.
- A LiteLLM callback that removes Codex `custom` tool entries before DeepSeek's
  chat endpoint receives the request.
- The specific fix for the ChatGPT-account error: set
  `model_provider = "deepseek"` whenever `model = "deepseek-v4-pro"` is active.

Reddit searches for Codex, DeepSeek, LiteLLM, `model_provider`, and the exact
ChatGPT-account error did not turn up an exact match.
