# OpenAI Compatible Endpoints

PonyBunny supports any OpenAI-compatible API endpoint through the `openai-compatible` endpoint configuration. This allows you to use local LLM servers, third-party providers, or custom deployments that implement the OpenAI API specification.

## Supported Services

The `openai-compatible` endpoint works with:

- **LocalAI** - Local inference server
- **vLLM** - High-performance inference engine
- **Ollama** - Local LLM runtime
- **LM Studio** - Desktop LLM application
- **Text Generation WebUI** - Gradio-based interface
- **FastChat** - Multi-model serving system
- **Third-party API proxies** - Services that proxy OpenAI API

## Configuration

### 1. Add Credentials

Edit `~/.ponybunny/credentials.json`:

```json
{
  "$schema": "./credentials.schema.json",
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "your-api-key-here",
      "baseUrl": "http://localhost:8000/v1"
    }
  }
}
```

**Fields:**
- `enabled`: Set to `true` to enable this endpoint
- `apiKey`: API key for authentication (use any string if not required)
- `baseUrl`: Base URL of your OpenAI-compatible service

### 2. Configure Endpoint in LLM Config

Edit `~/.ponybunny/llm-config.json`:

```json
{
  "$schema": "./llm-config.schema.json",
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "protocol": "openai",
      "baseUrl": "http://localhost:8000/v1",
      "priority": 3,
      "rateLimit": {
        "requestsPerMinute": 60
      }
    }
  }
}
```

### 3. Add Models

Define models that are available through your endpoint:

```json
{
  "models": {
    "llama-3-70b": {
      "displayName": "Llama 3 70B",
      "endpoints": ["openai-compatible"],
      "costPer1kTokens": {
        "input": 0.0,
        "output": 0.0
      },
      "maxContextTokens": 8192,
      "capabilities": ["text", "function-calling"],
      "thinking": false,
      "streaming": true
    }
  }
}
```

## Examples

### LocalAI

```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "not-needed",
      "baseUrl": "http://localhost:8080/v1"
    }
  }
}
```

### vLLM

```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "EMPTY",
      "baseUrl": "http://localhost:8000/v1"
    }
  }
}
```

### Ollama (with OpenAI compatibility)

```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "ollama",
      "baseUrl": "http://localhost:11434/v1"
    }
  }
}
```

### LM Studio

```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "lm-studio",
      "baseUrl": "http://localhost:1234/v1"
    }
  }
}
```

### Third-Party Proxy (e.g., fast-ai.chat)

```json
{
  "endpoints": {
    "openai-compatible": {
      "enabled": true,
      "apiKey": "tb_xxxxxxxxxxxxx",
      "baseUrl": "https://api.fast-ai.chat/v1"
    }
  }
}
```

## Environment Variables

You can also configure credentials via environment variables:

```bash
export OPENAI_COMPATIBLE_API_KEY="your-api-key"
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:8000/v1"
```

Environment variables take precedence over the credentials file.

## Using with Agents

Once configured, you can use your OpenAI-compatible models in tier or agent configurations:

```json
{
  "tiers": {
    "simple": {
      "primary": "llama-3-70b",
      "fallback": ["claude-haiku-4-5"]
    }
  },
  "agents": {
    "execution": {
      "primary": "llama-3-70b",
      "description": "ReAct execution with local model"
    }
  }
}
```

## Troubleshooting

### Connection Refused

Ensure your local server is running:

```bash
# Check if service is listening
curl http://localhost:8000/v1/models

# Check PonyBunny status
pb status
```

### Authentication Errors

Some services don't require authentication. Try:
- `"apiKey": "not-needed"`
- `"apiKey": "EMPTY"`
- `"apiKey": "sk-no-key-required"`

### Model Not Found

Verify the model name matches what your service expects:

```bash
# List available models
curl http://localhost:8000/v1/models
```

Update your `llm-config.json` with the correct model ID.

## Priority and Fallback

The `openai-compatible` endpoint has `priority: 3` by default (lower priority than official APIs). You can adjust this in `llm-config.json`:

```json
{
  "endpoints": {
    "openai-compatible": {
      "priority": 1  // Higher priority (1 = highest)
    }
  }
}
```

## Multiple Compatible Endpoints

To use multiple OpenAI-compatible services, you can override the `baseUrl` in the credentials file for existing endpoints:

```json
{
  "endpoints": {
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-local-key",
      "baseUrl": "http://localhost:8000/v1"
    },
    "openai-compatible": {
      "enabled": true,
      "apiKey": "sk-another-key",
      "baseUrl": "http://localhost:9000/v1"
    }
  }
}
```

## See Also

- [CLI Usage Guide](./CLI-USAGE.md)
- [LLM Configuration](../../README.md#configuration)
- [MCP Integration](./MCP-INTEGRATION.md)
