# Provider Onboarding Configuration Guide

This guide explains how to add a new LLM provider in two supported ways:

1. interactive CLI (`pb auth config` / `pb auth add-provider`)
2. direct file editing (`llm-config.json` + `credentials.json`)

It is intended as a practical companion to:

- `docs/schemas/llm-config.schema.json`
- `docs/schemas/credentials.schema.json`

## TL;DR

- Provider metadata goes in `llm-config.json` (`providers`, optional `models`, optional `providerAliases`).
- Provider credentials go in `credentials.json` (`providers.<providerId>`).
- For OpenAI-protocol providers, you can fetch model IDs from `/v1/models` in `pb auth config` after setting `baseUrl` + `apiKey`.

## Config File Paths

```text
~/.config/ponybunny/llm-config.json
~/.config/ponybunny/credentials.json
```

## Method A: Add Provider via `pb auth config`

### Step 1: Open the interactive config wizard

```bash
pb auth config
```

In the provider menu, choose:

- `+ Add provider (wizard)`

### Step 2: Fill provider metadata

The wizard asks for:

- `providerId` (letters/numbers/`-`/`_`, must be unique)
- `protocol` (`openai` / `anthropic` / `gemini` / `codex`)
- `type` (`api` or `oauth`)
- `baseUrl` (optional, but typically required for custom endpoints)
- `priority` (lower = preferred)
- `enabled` (on/off)

These values are written to `llm-config.json` -> `providers.<providerId>`.

### Step 3: Set credentials

For `type=api`, wizard also prompts API key (optional at creation time, can set later).

Credentials are written to:

- `credentials.json` -> `providers.<providerId>`

### Step 4 (optional): Fetch models for OpenAI-protocol provider

Inside provider configuration in `pb auth config`, choose:

- `Fetch models from /v1/models`

Requirements:

- provider `protocol` must be `openai`
- `apiKey` must be set
- `baseUrl` must be set

Selected model IDs are added to `llm-config.json` `models` as:

- `<providerId>.<modelId>`

with default model metadata scaffold.

## Method B: Add Provider by Editing Config Files Directly

Use this method when you want deterministic infra-managed changes.

### 1) Add provider metadata (`llm-config.json`)

```json
{
  "providers": {
    "openai-compatible-local": {
      "enabled": true,
      "protocol": "openai",
      "type": "api",
      "baseUrl": "http://localhost:8000/v1",
      "priority": 3
    }
  }
}
```

### 2) Add credentials (`credentials.json`)

```json
{
  "providers": {
    "openai-compatible-local": {
      "apiKey": "local-dev-token",
      "baseUrl": "http://localhost:8000/v1"
    }
  }
}
```

### 3) (Optional) Add model entries (`llm-config.json`)

```json
{
  "models": {
    "openai-compatible-local.qwen2.5-coder-32b": {
      "displayName": "Qwen2.5 Coder 32B",
      "costPer1kTokens": { "input": 0, "output": 0 },
      "capabilities": ["text", "function-calling"]
    }
  }
}
```

### 4) (Optional) Add alias and tier usage

```json
{
  "providerAliases": {
    "local-openai": {
      "protocol": "openai",
      "providers": ["openai-compatible-local"]
    }
  },
  "tiers": {
    "medium": {
      "primary": "openai-compatible-local.qwen2.5-coder-32b",
      "fallback": ["openai.gpt-5.2"]
    }
  }
}
```

## `/v1` URL Rules and Runtime Handling

When onboarding OpenAI-style providers (`protocol = openai`), URL composition is:

- resolved `baseUrl` + model endpoint path (for example `/v1/responses`)

### Resolution Priority for `baseUrl`

Runtime resolves provider base URL in this order:

1. `credentials.json` -> `providers.<providerId>.baseUrl`
2. `credentials.json` -> `providers.<providerId>.endpoint` (mainly Azure)
3. `llm-config.json` -> `providers.<providerId>.baseUrl`

So if both files define `baseUrl`, `credentials.json` wins.

### `/v1` Segment Rules

For OpenAI-compatible APIs, final request path should contain exactly one version segment where required.

Valid patterns:

- `baseUrl = https://host` and endpoint path includes `/v1/...`
- `baseUrl = https://host/v1` and endpoint path omits `/v1` (for example `/responses`)

Avoid:

- `baseUrl` without `/v1` + endpoint without `/v1` (can produce versionless paths like `/responses`)

### How System Handles Duplicates

PonyBunny runtime handles OpenAI-style URL composition to avoid duplicate `/v1` segments when both base URL and endpoint include version prefix.

Practical recommendation:

- pick one consistent style per provider and keep it stable across `llm-config.json` and `credentials.json`.

### Azure Note

Azure OpenAI uses deployment-style paths and `api-version`; do not force `/v1` as a global rule for Azure endpoints.

## Validation and Verification Checklist

After adding a provider:

1. Ensure JSON is schema-valid (`llm-config.schema.json`, `credentials.schema.json`).
2. Ensure provider is `enabled: true` in `llm-config.json`.
3. Ensure credentials exist for that same provider ID.
4. If using custom OpenAI endpoint, verify `baseUrl` includes the expected version path for that backend.
5. Run a quick runtime check:

```bash
pb status
```

## Test Newly Added Provider and Models

After onboarding, use `pb models` commands to verify enablement, routing visibility, and endpoint health.

### 1) Confirm provider/model appears in runtime list

```bash
pb models list
```

Check that:

- your provider is listed as enabled
- your model key (`<providerId>.<modelId>`) appears in the catalog

### 2) Run a functional model invocation test

```bash
pb models test --model <providerId>.<modelId>
```

Use this to verify end-to-end callability (credentials + baseUrl + model resolution).

### 3) Run provider/model health probe

```bash
pb models probe
```

Use probe output to validate health/availability signals before relying on the provider in tiers/workloads.

Recommended sequence:

1. `pb models list`
2. `pb models test --model <providerId>.<modelId>`
3. `pb models probe`

## Common Pitfalls

- Provider ID mismatch between `llm-config.json` and `credentials.json`.
- `protocol=openai` provider without `baseUrl` when endpoint is not OpenAI default.
- Model key typo: must follow `<providerId>.<modelId>` naming.
- Setting provider metadata but never adding credentials.
