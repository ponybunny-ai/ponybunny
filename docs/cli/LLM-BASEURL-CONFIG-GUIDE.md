# LLM baseUrl Configuration Guide

This guide explains how to configure `baseUrl` for PonyBunny LLM providers, with special focus on whether `/v1` is required.

## TL;DR

- For OpenAI-style providers, PonyBunny combines `baseUrl` with model endpoint URLs.
- `/v1` does not have to be hardcoded in `baseUrl` in all cases.
- The final request path must contain exactly one API version segment where required.
- In runtime resolution, `credentials.json` `baseUrl` overrides `llm-config.json` `baseUrl`.

## Config Files and Roles

### `credentials.json`

Use this file for secrets and endpoint-specific credential overrides.

Path:

```text
~/.config/ponybunny/credentials.json
```

Typical structure:

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/credentials.schema.json",
  "providers": {
    "openai-direct": {
      "apiKey": "...",
      "baseUrl": "https://api.openai.com/v1"
    },
    "openai-compatible": {
      "apiKey": "...",
      "baseUrl": "https://my-endpoint.example.com"
    },
    "azure-openai": {
      "apiKey": "...",
      "endpoint": "https://my-resource.openai.azure.com"
    }
  }
}
```

### `llm-config.json`

Use this file for provider enablement, model routing, and model endpoint definitions.

Path:

```text
~/.config/ponybunny/llm-config.json
```

Typical OpenAI model section:

```json
{
  "providers": {
    "openai-direct": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "https://api.openai.com/v1"
    },
    "openai-compatible": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "https://my-endpoint.example.com"
    }
  },
  "models": {
    "gpt-5.2": {
      "providers": ["openai-direct", "openai-compatible"],
      "endpoints": [{ "name": "responses", "url": "/v1/responses" }]
    }
  }
}
```

## Runtime Precedence

For each endpoint, PonyBunny resolves URL base in this order:

1. `credentials.json` provider `baseUrl`
2. `credentials.json` provider `endpoint` (mainly Azure)
3. `llm-config.json` provider `baseUrl`

So if both files define `baseUrl`, `credentials.json` wins.

## `/v1` Rules by Provider Type

### OpenAI Direct / OpenAI Compatible

For model endpoint `"/v1/responses"` (default), both styles can work:

- `baseUrl = https://api.openai.com`
- `baseUrl = https://api.openai.com/v1`

PonyBunny avoids duplicate `/v1` when both base and endpoint include it.

Recommended safe combinations:

- `baseUrl` without `/v1` + endpoint with `/v1/...`
- `baseUrl` with `/v1` + endpoint without `/v1/...`

Avoid this mismatch:

- `baseUrl` without `/v1` + endpoint without `/v1/...`

That will call a versionless path such as `/responses`, which is often wrong for OpenAI-style APIs.

### Azure OpenAI

Azure uses a deployment-style URL:

```text
{azure-endpoint}/openai/deployments/{model}{endpointPath}?api-version=...
```

Do not manually add `/v1` to Azure endpoint as a requirement. Keep:

- `endpoint` as the Azure resource host (for example `https://my-resource.openai.azure.com`)

### Anthropic / Gemini

- Anthropic direct default base includes API path (`/v1/messages`)
- Gemini has provider-specific defaults (for example `.../v1beta`)

Follow provider defaults unless you intentionally proxy these APIs.

## Practical Recommendations

### Recommendation A (default and simple)

- Keep model endpoint as `"/v1/responses"`
- Set OpenAI-compatible `baseUrl` to host root (no `/v1`)

Example:

```json
{
  "providers": {
    "openai-compatible": {
      "baseUrl": "https://my-endpoint.example.com"
    }
  },
  "models": {
    "gpt-5.2": {
      "endpoints": [{ "name": "responses", "url": "/v1/responses" }]
    }
  }
}
```

### Recommendation B (also valid)

- If `baseUrl` already includes `/v1`, set endpoint to `/responses`

Example:

```json
{
  "providers": {
    "openai-compatible": {
      "baseUrl": "https://my-endpoint.example.com/v1"
    }
  },
  "models": {
    "gpt-5.2": {
      "endpoints": [{ "name": "responses", "url": "/responses" }]
    }
  }
}
```

## Troubleshooting

If requests fail with 404/route not found:

1. Check effective `baseUrl` source (credentials overrides config)
2. Check model endpoint URL (`/v1/responses` vs `/responses`)
3. Ensure resulting full path includes one correct version segment
4. For Azure, verify endpoint host and deployment model mapping first

## Summary

`/v1` is not globally mandatory in `baseUrl` itself. What matters is the final combined URL path.
Use one consistent strategy per provider and avoid version segment duplication or omission.
