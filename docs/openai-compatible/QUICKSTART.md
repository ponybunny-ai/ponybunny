# OpenAI Compatible Endpoint - Quick Reference

## 快速开始

### 1. 添加凭证

编辑 `~/.ponybunny/credentials.json`:

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

### 2. 配置 Endpoint

编辑 `~/.ponybunny/llm-config.json`:

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

### 3. 添加模型

```json
{
  "models": {
    "your-model-name": {
      "displayName": "Your Model",
      "endpoints": ["openai-compatible"],
      "costPer1kTokens": { "input": 0.0, "output": 0.0 },
      "maxContextTokens": 8192,
      "capabilities": ["text"],
      "streaming": true
    }
  }
}
```

### 4. 验证

```bash
pb status
```

## 常见服务配置

### LocalAI
```json
{
  "apiKey": "not-needed",
  "baseUrl": "http://localhost:8080/v1"
}
```

### vLLM
```json
{
  "apiKey": "EMPTY",
  "baseUrl": "http://localhost:8000/v1"
}
```

### Ollama
```json
{
  "apiKey": "ollama",
  "baseUrl": "http://localhost:11434/v1"
}
```

### LM Studio
```json
{
  "apiKey": "lm-studio",
  "baseUrl": "http://localhost:1234/v1"
}
```

### 第三方代理
```json
{
  "apiKey": "tb_xxxxxxxxxxxxx",
  "baseUrl": "https://api.fast-ai.chat/v1"
}
```

## 环境变量

```bash
export OPENAI_COMPATIBLE_API_KEY="your-api-key"
export OPENAI_COMPATIBLE_BASE_URL="http://localhost:8000/v1"
```

## 故障排查

### 连接被拒绝
```bash
# 检查服务是否运行
curl http://localhost:8000/v1/models
```

### 认证错误
某些服务不需要认证，尝试：
- `"apiKey": "not-needed"`
- `"apiKey": "EMPTY"`
- `"apiKey": "sk-no-key-required"`

### 模型未找到
```bash
# 列出可用模型
curl http://localhost:8000/v1/models
```

## 完整文档

详细文档请参考：
- [OpenAI Compatible Endpoints 完整指南](../cli/OPENAI-COMPATIBLE-ENDPOINTS.md)
- [技术实现文档](../techspec/openai-compatible-implementation.md)
