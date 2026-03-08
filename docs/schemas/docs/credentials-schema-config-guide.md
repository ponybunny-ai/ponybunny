# `credentials.schema.json` Configuration Guide

This guide explains every field in `docs/schemas/credentials.schema.json`.

## Purpose

`credentials.json` stores provider credentials used by LLM providers/endpoints. It is a per-provider credential map and intentionally keeps the structure simple.

## Full Example

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/credentials.schema.json",
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-...",
      "baseUrl": ""
    },
    "openai": {
      "apiKey": "sk-...",
      "baseUrl": ""
    },
    "aws-bedrock": {
      "accessKeyId": "AKIA...",
      "secretAccessKey": "...",
      "region": "us-east-1",
      "baseUrl": ""
    },
    "azure-openai": {
      "apiKey": "...",
      "endpoint": "https://<resource>.openai.azure.com",
      "baseUrl": ""
    },
    "openai-compatible": {
      "apiKey": "...",
      "baseUrl": "http://localhost:8000"
    },
    "google-ai-studio": {
      "apiKey": "...",
      "baseUrl": ""
    },
    "google-vertex-ai": {
      "projectId": "my-project",
      "region": "us-central1",
      "baseUrl": ""
    }
  }
}
```

## Top-Level Fields

- `$schema`: Schema URI for editor/tool validation.
- `providers`: Provider ID -> endpoint credential object.

## `providers.<providerId>` Field Reference

All fields below are optional in schema, but practical requirements depend on provider protocol.

- `apiKey` (`string`): API key for providers that use token auth (Anthropic/OpenAI/Google AI Studio/Azure).
- `accessKeyId` (`string`): AWS Access Key ID (AWS Bedrock).
- `secretAccessKey` (`string`): AWS Secret Access Key (AWS Bedrock).
- `region` (`string`): AWS region (Bedrock) or Google region (Vertex AI).
- `endpoint` (`string`): Azure OpenAI endpoint URL.
- `projectId` (`string`): Google Cloud project ID (Vertex AI).
- `baseUrl` (`string`): Provider base URL override.

## Provider Usage Notes

- `anthropic` / `openai` / `google-ai-studio`: usually require `apiKey`.
- `aws-bedrock`: typically needs `accessKeyId`, `secretAccessKey`, `region`.
- `azure-openai`: typically needs `apiKey` + `endpoint`.
- `google-vertex-ai`: typically needs `projectId` + `region`.
- `openai-compatible`: usually needs `baseUrl`, and commonly `apiKey` (or a placeholder if endpoint ignores auth).

## `/v1` URL Rules and Runtime Handling

For OpenAI-style providers, credentials-level URL fields participate in final request URL composition.

Runtime base URL precedence:

1. `credentials.json` `providers.<providerId>.baseUrl`
2. `credentials.json` `providers.<providerId>.endpoint` (mainly Azure)
3. `llm-config.json` provider `baseUrl`

This means credentials file values override `llm-config.json` URL values.

`/v1` rule:

- final request path should contain exactly one version segment where required

Valid patterns:

- credentials `baseUrl` without `/v1` + endpoint path with `/v1/...`
- credentials `baseUrl` with `/v1` + endpoint path without `/v1`

Avoid:

- base URL and endpoint path both lacking `/v1` on APIs that require versioned paths

System behavior:

- runtime handling avoids duplicate `/v1` when both components include version prefix

Azure note:

- Azure OpenAI uses deployment-style endpoint paths and `api-version`, so do not force generic `/v1` assumptions for Azure.

## Safety and Operations

- Treat this file as secret material.
- Avoid committing real credentials.
- Prefer environment-variable injection in CI/production when possible.
