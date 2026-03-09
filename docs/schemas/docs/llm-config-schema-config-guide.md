# `llm-config.schema.json` Configuration Guide

This guide explains every configuration section in `docs/schemas/llm-config.schema.json` and how each field influences model routing and provider behavior.

## Purpose

`llm-config.json` defines:

- Provider connectivity and priority
- Model catalog metadata (cost/capabilities/limits)
- Tier policy (`simple|medium|complex`)
- Workload-to-tier mapping
- Global defaults (timeouts, retries, temperature)

## Full Example

Use `docs/config-templates/llm-config.example.json` as a full starter. Key shape:

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/llm-config.schema.json",
  "providers": {},
  "models": {},
  "providerAliases": {},
  "tiers": {
    "simple": { "primary": "anthropic.claude-sonnet-4-5-20250929", "fallback": ["openai.gpt-5.2"] },
    "medium": { "primary": "openai.gpt-5.2", "fallback": ["anthropic.claude-sonnet-4-5-20250929"] },
    "complex": { "primary": "openai.gpt-5.2", "fallback": ["anthropic.claude-sonnet-4-5-20250929"] }
  },
  "workloads": {
    "planning": { "tier": "complex", "description": "Goal decomposition and planning" }
  },
  "defaults": {
    "timeout": 120000,
    "maxTokens": 4096,
    "maxRetries": 2,
    "retryDelayMs": 1000,
    "temperature": 0.7
  }
}
```

## Top-Level Fields

- `$schema`: Schema URI.
- `providers`: Provider endpoint config registry.
- `models`: Model metadata catalog; supports nested provider group maps.
- `providerAliases`: Logical alias -> protocol + concrete provider list.
- `tiers`: Tier-level model policy.
- `workloads`: Workload -> tier mapping and descriptions.
- `defaults`: Baseline completion options.

## Field-by-Field Reference

### `providers.<providerId>`

- `enabled` (`boolean`): Provider availability switch.
- `protocol` (`anthropic|openai|gemini|codex`): Protocol family.
- `type` (`api|oauth`, optional): Auth mode.
- `baseUrl` (`string`, optional): Custom API base URL.
- `priority` (`integer >= 1`): Provider priority in protocol group.
- `rateLimit.requestsPerMinute` (`integer >= 1`, optional): Request throttle hint.
- `rateLimit.tokensPerMinute` (`integer >= 1`, optional): Token throttle hint.
- `region` (`string`, optional): Region for regional providers.
- `costMultiplier` (`number >= 0`, optional): Cost normalization multiplier.
- `health.available` (`boolean`, optional): Manual/recorded availability.
- `health.lastCheckedAt` (`string`, optional): Last health probe timestamp.
- `health.lastError` (`string`, optional): Last health error message.

### `models`

`models` supports two valid shapes:

1. Direct model config map
2. Provider-grouped map where each entry is another model config map

Each model config (`$defs.ModelConfig`) fields:

- `displayName` (required): Human-readable model label.
- `costPer1kTokens.input|output` (required): Cost metadata.
- `providers` (`string[]`, optional): Provider IDs able to serve this model.
- `endpoints[]` (`name`,`url`, optional): Endpoint-level mapping.
- `maxContextTokens` (`integer >= 1`, optional)
- `maxOutputTokens` (`integer >= 1`, optional)
- `contextWindow` (`integer >= 1`, optional)
- `reasoningTokenSupport` (`boolean`, optional)
- `reasoningEfforts` (`string[]`, optional)
- `capabilities` (array or `{input,output}` object, optional)
- `parameterSupport.temperature|topP|topK|topN` (`boolean`, optional)
- `disallowedParams` (`string[]`, optional)
- `features` (`string[]`, optional)
- `tools` (`string[]`, optional)
- `health.lastCheckedAt|available|lastError` (optional)

### `providerAliases.<aliasId>`

- `protocol` (required): Protocol family.
- `providers` (`string[]`, required, min 1): Concrete provider IDs behind alias.

### `tiers.simple|medium|complex`

- `primary` (`string`, required): First model candidate for the tier.
- `fallback` (`string[]`, optional): Ordered fallback chain.

### `workloads.<workloadId>`

- `tier` (`simple|medium|complex`, optional): Tier binding.
- `description` (`string`, optional): Human-readable workload purpose.

Note: Workload-level model override keys are intentionally removed; model decisions come from explicit override/agent/tier policy.

### `defaults`

- `timeout` (`integer >= 1000`): Request timeout.
- `maxTokens` (`integer >= 1`): Default max output token cap.
- `maxRetries` (`integer >= 0`): Retry count.
- `retryDelayMs` (`integer >= 0`): Retry backoff delay.
- `temperature` (`0-2`): Default generation temperature.

## Operational Impact

- `tiers` + `workloads` define baseline routing policy.
- `providers.enabled` and health fields control practical availability.
- Model metadata controls capability checks, context limits, and cost accounting.

## `/v1` URL Rules and Runtime Handling

For OpenAI-style providers (`protocol = openai`), runtime composes request URL from:

- resolved provider `baseUrl`
- model endpoint path (for example `/v1/responses`)

Base URL resolution priority:

1. `credentials.json` -> `providers.<providerId>.baseUrl`
2. `credentials.json` -> `providers.<providerId>.endpoint` (mainly Azure)
3. `llm-config.json` -> `providers.<providerId>.baseUrl`

`/v1` rule:

- final request path should contain exactly one version segment where required

Valid patterns:

- `baseUrl = https://host` + endpoint path includes `/v1/...`
- `baseUrl = https://host/v1` + endpoint path omits `/v1` (for example `/responses`)

Avoid:

- `baseUrl` without `/v1` + endpoint without `/v1` (can produce versionless paths)

System behavior:

- runtime handling avoids duplicate `/v1` when both base URL and endpoint include version prefix
- use one consistent style per provider and keep it stable across config files

Azure note:

- Azure OpenAI uses deployment-style paths and `api-version`; do not apply generic `/v1` assumptions to Azure endpoint format.
