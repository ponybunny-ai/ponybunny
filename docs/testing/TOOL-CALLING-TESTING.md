# Tool Calling 测试指南

本文档介绍如何测试 PonyBunny 的原生 tool calling 功能。

## 测试层级

### 1. 单元测试 - Protocol Adapters

测试协议适配器是否正确转换工具调用格式。

```bash
# 运行 protocol adapter 测试
npx jest test/infra/llm/protocols/tool-calling.test.ts
```

**测试内容：**
- ✅ 工具定义格式转换（统一格式 → provider 格式）
- ✅ 工具调用消息格式化
- ✅ 工具结果消息格式化
- ✅ 响应解析（provider 格式 → 统一格式）
- ✅ Thinking 内容提取
- ✅ Streaming chunk 解析

### 2. E2E 测试 - 完整流程

测试完整的工具调用流程，包括 LLM 调用和工具执行。

```bash
# 运行 E2E demo（需要配置 API keys）
npx tsx test/e2e/tool-calling-demo.ts
```

**测试场景：**
1. **简单对话**：不使用工具的基础对话
2. **单次工具调用**：LLM 请求调用工具
3. **多轮工具调用**：工具执行后继续对话
4. **Thinking 模式**：测试推理过程记录

### 3. 集成测试 - ReAct Integration

测试 ReAct 循环中的原生工具调用。

```bash
# 创建测试文件
npx tsx test/integration/react-tool-calling.test.ts
```

## 前置准备

### 1. 配置 API Keys

确保已配置至少一个 LLM provider 的 API key：

```bash
# 编辑 credentials.json
vim ~/.ponybunny/credentials.json
```

示例配置：

```json
{
  "$schema": "./credentials.schema.json",
  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx"
    },
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-xxx"
    }
  }
}
```

### 2. 配置 LLM Models

确保 `llm-config.json` 中配置了支持工具调用的模型：

```json
{
  "models": {
    "claude-3-5-sonnet-20241022": {
      "displayName": "Claude 3.5 Sonnet",
      "costPer1kInput": 0.003,
      "costPer1kOutput": 0.015,
      "contextWindow": 200000,
      "thinking": true,
      "streaming": true,
      "endpoints": ["anthropic-direct"]
    },
    "gpt-4-turbo": {
      "displayName": "GPT-4 Turbo",
      "costPer1kInput": 0.01,
      "costPer1kOutput": 0.03,
      "contextWindow": 128000,
      "streaming": true,
      "endpoints": ["openai-direct"]
    }
  }
}
```

## 测试步骤

### Step 1: 运行单元测试

```bash
# 编译项目
npm run build

# 运行 protocol adapter 测试
npx jest test/infra/llm/protocols/tool-calling.test.ts --verbose
```

**预期结果：**
- ✅ 所有测试通过
- ✅ 工具定义格式正确
- ✅ 消息转换正确
- ✅ 响应解析正确

### Step 2: 运行 E2E Demo

```bash
# 运行完整的 E2E demo
npx tsx test/e2e/tool-calling-demo.ts
```

**预期输出：**

```
🚀 Tool Calling Demo

📦 Available tools: web_search, find_skills

=== Test 1: Simple Conversation ===
Response: Hello! I'm doing well, thank you for asking...
Tokens used: 45
Finish reason: stop

=== Test 2: Tool Calling (Web Search) ===
Response content: null
Tokens used: 120
Finish reason: tool_calls

🔧 Tool calls detected:
  - web_search
    Arguments: {"query":"weather in Shanghai today"}

=== Test 3: Multi-turn with Tool Execution ===
First response:
  Content: null
  Finish reason: tool_calls

🔧 Tool calls:
  - Executing web_search...

📥 Sending tool results back to LLM...

Final response:
  Content: Based on the search results, here's what I found...
  Finish reason: stop

=== Test 4: Thinking Mode ===
Response: Recursion is a programming technique where...
Tokens used: 250

💭 Thinking process:
Let me break down the concept of recursion step by step...

✅ Demo completed!
```

### Step 3: 测试不同 Provider

修改 `llm-config.json` 中的 agent 配置来测试不同 provider：

```json
{
  "agents": {
    "conversation": {
      "tier": "medium",
      "models": ["claude-3-5-sonnet-20241022"]  // 或 "gpt-4-turbo"
    }
  }
}
```

然后重新运行 E2E demo。

### Step 4: 测试 Streaming

创建 streaming 测试：

```typescript
// test/e2e/streaming-tool-calling.ts
import { getLLMService } from '../../src/infra/llm/llm-service.js';
import { getGlobalToolProvider } from '../../src/infra/tools/tool-provider.js';

async function testStreaming() {
  const llmService = getLLMService();
  const toolProvider = getGlobalToolProvider();
  const tools = toolProvider.getToolDefinitions();

  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Tell me a story about AI' },
  ];

  console.log('Testing streaming...\n');

  const response = await llmService.completeForAgent('conversation', messages, {
    maxTokens: 500,
    stream: true,
    thinking: true,
    onChunk: (chunk) => {
      if (chunk.thinking) {
        process.stdout.write(`[THINKING] ${chunk.thinking}`);
      }
      if (chunk.content) {
        process.stdout.write(chunk.content);
      }
      if (chunk.done) {
        console.log(`\n\n[DONE] Finish reason: ${chunk.finishReason}`);
      }
    },
  });

  console.log('\nFinal response:', response.content);
}

testStreaming().catch(console.error);
```

运行：

```bash
npx tsx test/e2e/streaming-tool-calling.ts
```

## 验证清单

### ✅ 核心功能

- [ ] 工具定义正确生成（JSON Schema 格式）
- [ ] 工具调用消息正确格式化
- [ ] 工具结果消息正确格式化
- [ ] LLM 能够请求工具调用
- [ ] 工具调用参数正确解析
- [ ] 工具执行结果正确返回
- [ ] 多轮工具调用正常工作

### ✅ Provider 支持

- [ ] Anthropic: 工具调用正常
- [ ] Anthropic: Thinking 模式正常
- [ ] Anthropic: Streaming 正常
- [ ] OpenAI: 工具调用正常
- [ ] OpenAI: Reasoning content (o1) 正常
- [ ] OpenAI: Streaming 正常
- [ ] Gemini: 工具调用正常
- [ ] Gemini: Streaming 正常

### ✅ 错误处理

- [ ] 工具不存在时正确处理
- [ ] 工具参数错误时正确处理
- [ ] 工具执行失败时正确处理
- [ ] API 错误时正确 fallback
- [ ] Streaming 中断时正确恢复

### ✅ 性能

- [ ] 响应时间 < 3 秒（单次工具调用）
- [ ] 内存使用正常
- [ ] 无内存泄漏
- [ ] Streaming 延迟低

## 常见问题

### Q1: 测试时 LLM 不调用工具？

**可能原因：**
1. 模型不支持工具调用
2. 工具定义不清晰
3. 用户提示不明确

**解决方案：**
- 使用支持工具调用的模型（Claude 3.5, GPT-4, Gemini Pro）
- 改进工具描述和参数说明
- 使用更明确的提示词（如 "Search for..."）

### Q2: 工具调用参数解析失败？

**可能原因：**
1. JSON Schema 定义不正确
2. LLM 返回的参数格式不符合预期

**解决方案：**
- 检查 `tool-provider.ts` 中的参数定义
- 添加参数验证逻辑
- 查看 LLM 返回的原始参数

### Q3: Streaming 模式下工具调用不工作？

**可能原因：**
1. Streaming 中工具调用需要累积多个 chunk
2. 当前实现简化了 streaming 工具调用

**解决方案：**
- 使用非 streaming 模式测试工具调用
- 或实现完整的 streaming 工具调用状态管理

### Q4: Thinking 内容为空？

**可能原因：**
1. 模型不支持 thinking 模式
2. 配置中未启用 thinking

**解决方案：**
- 使用支持 thinking 的模型（Claude 3.5 with extended thinking, OpenAI o1）
- 在 `llm-config.json` 中设置 `"thinking": true`
- 在调用时传递 `thinking: true` 选项

## 下一步

完成测试后，可以：

1. **集成到 CI/CD**：添加自动化测试
2. **性能优化**：分析和优化工具调用性能
3. **扩展工具**：添加更多工具定义
4. **改进 UX**：在 UI 中显示工具调用过程

## 参考文档

- [Plan: Native Tool Calling](.claude/plan.md)
- [Anthropic Tool Use API](https://docs.anthropic.com/claude/docs/tool-use)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Gemini Function Calling](https://ai.google.dev/docs/function_calling)
