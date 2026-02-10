# OpenAI Compatible Endpoint Implementation

## Summary

Added support for OpenAI-compatible API endpoints to PonyBunny's LLM provider system. This allows users to connect to any service that implements the OpenAI API specification, including local inference servers and third-party providers.

## Changes Made

### 1. Core Type Definitions

**File: `src/infra/llm/endpoints/endpoint-config.ts`**
- Added `'openai-compatible'` to `EndpointId` type
- Added environment variable mappings:
  - `OPENAI_COMPATIBLE_API_KEY` → `apiKey`
  - `OPENAI_COMPATIBLE_BASE_URL` → `baseUrl`

### 2. Endpoint Registry

**File: `src/infra/llm/endpoints/endpoint-registry.ts`**
- Added `openai-compatible` endpoint configuration:
  ```typescript
  'openai-compatible': {
    id: 'openai-compatible',
    protocol: 'openai',
    baseUrl: '', // Set from OPENAI_COMPATIBLE_BASE_URL or credentials file
    requiredEnvVars: ['OPENAI_COMPATIBLE_API_KEY'],
    optionalEnvVars: ['OPENAI_COMPATIBLE_BASE_URL'],
    priority: 3,
    displayName: 'OpenAI Compatible',
    description: 'Any OpenAI-compatible API endpoint (e.g., LocalAI, vLLM, Ollama, LM Studio)',
  }
  ```

### 3. Documentation

**File: `docs/cli/OPENAI-COMPATIBLE-ENDPOINTS.md`**
- Comprehensive guide for using OpenAI-compatible endpoints
- Configuration examples for popular services:
  - LocalAI
  - vLLM
  - Ollama
  - LM Studio
  - Text Generation WebUI
  - Third-party API proxies
- Troubleshooting section
- Environment variable configuration

### 4. Example Configuration Files

**File: `credentials.example.json`**
- Added example configuration for all endpoints including `openai-compatible`

**File: `llm-config.example.json`**
- Added `openai-compatible` endpoint configuration
- Added example local model: `llama-3-70b-local`

### 5. Updated Documentation

**Files: `CLAUDE.md`, `README.md`**
- Updated credentials examples to include `openai-compatible` endpoint

## Usage

### Basic Configuration

1. **Add credentials** (`~/.ponybunny/credentials.json`):
```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "your-api-key",
      "baseUrl": "http://localhost:8000/v1"
    }
  }
}
```

2. **Configure endpoint** (`~/.ponybunny/llm-config.json`):
```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "http://localhost:8000/v1",
      "priority": 3
    }
  }
}
```

3. **Add models**:
```json
{
  "models": {
    "llama-3-70b": {
      "displayName": "Llama 3 70B",
      "endpoints": ["openai-compatible"],
      "costPer1kTokens": { "input": 0.0, "output": 0.0 },
      "maxContextTokens": 8192,
      "capabilities": ["text", "function-calling"],
      "streaming": true
    }
  }
}
```

### Environment Variables

Alternatively, use environment variables:
```bash
export OPENAI_COMPATIBLE_API_KEY="your-api-key"
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:8000/v1"
```

## Supported Services

- **LocalAI** - Local inference server
- **vLLM** - High-performance inference engine
- **Ollama** - Local LLM runtime (with OpenAI compatibility)
- **LM Studio** - Desktop LLM application
- **Text Generation WebUI** - Gradio-based interface
- **FastChat** - Multi-model serving system
- **Third-party API proxies** - Services that proxy OpenAI API

## Technical Details

### Protocol Adapter

The `openai-compatible` endpoint uses the existing `openai` protocol adapter (`OpenAIProtocolAdapter`), which handles:
- Request formatting (messages, tools, streaming)
- Response parsing
- Error handling
- Authentication headers

### Priority System

Default priority is `3` (lower than official APIs):
- Priority 1: Official APIs (anthropic-direct, openai-direct, google-ai-studio)
- Priority 2: Cloud providers (aws-bedrock, azure-openai, google-vertex-ai)
- Priority 3: Compatible endpoints (openai-compatible)

Users can override priority in `llm-config.json`.

### Credential Resolution

Credentials are resolved with the following priority:
1. Environment variables (`OPENAI_COMPATIBLE_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`)
2. Credentials file (`~/.ponybunny/credentials.json`)

The `baseUrl` can be set in either location.

## Testing

Build the project to verify TypeScript compilation:
```bash
npm run build
```

Test with a local service:
```bash
# Start your OpenAI-compatible service
# Configure credentials and llm-config
pb status  # Verify configuration
```

## Future Enhancements

Potential improvements:
1. Support for multiple OpenAI-compatible endpoints (e.g., `openai-compatible-1`, `openai-compatible-2`)
2. Auto-discovery of available models from `/v1/models` endpoint
3. Custom authentication schemes (beyond Bearer token)
4. Per-endpoint timeout and retry configuration

## Related Files

- `src/infra/llm/endpoints/endpoint-config.ts` - Type definitions
- `src/infra/llm/endpoints/endpoint-registry.ts` - Endpoint configurations
- `src/infra/llm/protocols/openai-protocol.ts` - OpenAI protocol adapter
- `src/infra/config/credentials-loader.ts` - Credentials management
- `docs/cli/OPENAI-COMPATIBLE-ENDPOINTS.md` - User documentation
