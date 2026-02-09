# 方案 B：原生 Tool Calling 支持 - 实现计划

## 目标
为 PonyBunny 添加原生的 tool calling 支持，支持多种 LLM provider 的不同工具调用格式。

## 架构设计：三层解耦

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (ResponseGenerator, ReActIntegration)                       │
│  - 使用统一的 Tool 接口                                       │
│  - 不关心底层 provider 差异                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Abstraction Layer                          │
│  (LLMProvider, ToolDefinition)                               │
│  - 统一的工具定义格式                                         │
│  - 统一的工具调用/响应接口                                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Protocol Layer                             │
│  (AnthropicProtocol, OpenAIProtocol, GeminiProtocol)         │
│  - 转换统一格式 ↔ provider 特定格式                          │
│  - 处理 provider 特定的工具调用语法                           │
└─────────────────────────────────────────────────────────────┘
```

## 核心接口设计

### 1. 统一的工具定义格式（JSON Schema）

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
}

interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: any[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
}
```

### 2. 扩展 LLMMessage 支持工具调用

```typescript
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;  // null when tool_calls present
  tool_calls?: ToolCall[];  // Assistant 发起的工具调用
  tool_call_id?: string;    // Tool result message
}

interface ToolCall {
  id: string;              // 工具调用的唯一 ID
  type: 'function';
  function: {
    name: string;
    arguments: string;     // JSON string
  };
}
```

### 3. 扩展 LLMResponse 支持工具调用、thinking 和 streaming

```typescript
interface LLMResponse {
  content: string | null;
  tokensUsed: number;
  model: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  toolCalls?: ToolCall[];  // LLM 请求的工具调用
  thinking?: string;       // 推理过程（如果模型支持）
}
```

### 4. 扩展 LLMProviderConfig 支持工具、thinking 和 streaming

```typescript
interface LLMProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  tools?: ToolDefinition[];      // 可用的工具列表
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  thinking?: boolean;            // 是否启用 thinking mode（默认根据模型配置）
  stream?: boolean;              // 是否启用 streaming（默认根据模型配置）
  onChunk?: (chunk: StreamChunk) => void;  // Streaming 回调
}

interface StreamChunk {
  content?: string;              // 文本内容
  thinking?: string;             // 推理内容
  toolCalls?: ToolCall[];        // 工具调用
  done: boolean;                 // 是否完成
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
}
```

## Protocol Adapter 的职责

每个 protocol adapter 负责：

1. **格式转换**：统一格式 ↔ provider 格式
2. **语法适配**：处理 provider 特定的字段名和结构
3. **错误处理**：统一错误格式

### Anthropic Protocol

Anthropic API 使用 `tools` 参数，格式与 OpenAI 类似但有细微差异：

```typescript
// 统一格式 → Anthropic 格式
{
  tools: [
    {
      name: "web_search",
      description: "Search the web",
      parameters: { type: "object", properties: {...} }
    }
  ],
  thinking: true,  // 启用 extended thinking
  stream: true     // 启用 streaming
}
↓
{
  tools: [
    {
      name: "web_search",
      description: "Search the web",
      input_schema: { type: "object", properties: {...} }
    }
  ],
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  stream: true
}

// Anthropic 响应格式（非 streaming）
{
  content: [
    {
      type: "thinking",
      thinking: "Let me analyze this request..."
    },
    {
      type: "tool_use",
      id: "toolu_xxx",
      name: "web_search",
      input: { query: "weather in Shanghai" }
    }
  ],
  stop_reason: "tool_use"
}

// Anthropic streaming 格式
// Event: content_block_start
{
  type: "content_block_start",
  index: 0,
  content_block: {
    type: "thinking",
    thinking: ""
  }
}

// Event: content_block_delta
{
  type: "content_block_delta",
  index: 0,
  delta: {
    type: "thinking_delta",
    thinking: "Let me think..."
  }
}

// Event: content_block_start (tool use)
{
  type: "content_block_start",
  index: 1,
  content_block: {
    type: "tool_use",
    id: "toolu_xxx",
    name: "web_search"
  }
}

// Event: content_block_delta (tool input)
{
  type: "content_block_delta",
  index: 1,
  delta: {
    type: "input_json_delta",
    partial_json: "{\"query\":"
  }
}
```

### OpenAI Protocol

OpenAI API 使用 `tools` 参数（新版）或 `functions`（旧版）：

```typescript
// 统一格式 → OpenAI 格式
{
  tools: [
    {
      name: "web_search",
      description: "Search the web",
      parameters: { type: "object", properties: {...} }
    }
  ],
  thinking: true,  // o1 系列支持
  stream: true
}
↓
{
  tools: [
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object", properties: {...} }
      }
    }
  ],
  // o1 系列自动启用 reasoning
  stream: true
}

// OpenAI 响应格式（非 streaming）
{
  choices: [{
    message: {
      role: "assistant",
      content: null,
      reasoning_content: "Let me think...", // o1 系列
      tool_calls: [
        {
          id: "call_xxx",
          type: "function",
          function: {
            name: "web_search",
            arguments: '{"query":"weather in Shanghai"}'
          }
        }
      ]
    },
    finish_reason: "tool_calls"
  }]
}

// OpenAI streaming 格式
// Chunk 1: reasoning (o1)
{
  choices: [{
    delta: {
      reasoning_content: "Let me"
    }
  }]
}

// Chunk 2: tool call start
{
  choices: [{
    delta: {
      tool_calls: [
        {
          index: 0,
          id: "call_xxx",
          type: "function",
          function: {
            name: "web_search",
            arguments: ""
          }
        }
      ]
    }
  }]
}

// Chunk 3: tool arguments
{
  choices: [{
    delta: {
      tool_calls: [
        {
          index: 0,
          function: {
            arguments: "{\"query\":"
          }
        }
      ]
    }
  }]
}

// Final chunk
{
  choices: [{
    delta: {},
    finish_reason: "tool_calls"
  }]
}
```

### Gemini Protocol

Gemini API 使用 `tools` 参数，格式略有不同：

```typescript
// 统一格式 → Gemini 格式
{
  tools: [
    {
      name: "web_search",
      description: "Search the web",
      parameters: { type: "object", properties: {...} }
    }
  ]
}
↓
{
  tools: [
    {
      function_declarations: [
        {
          name: "web_search",
          description: "Search the web",
          parameters: { type: "object", properties: {...} }
        }
      ]
    }
  ]
}

// Gemini 响应格式
{
  candidates: [{
    content: {
      parts: [
        {
          functionCall: {
            name: "web_search",
            args: { query: "weather in Shanghai" }
          }
        }
      ]
    },
    finishReason: "STOP"
  }]
}
```

## 实现步骤

### Phase 1: 核心接口扩展（2-3 小时）
- [ ] 扩展 `LLMMessage` 接口支持 tool_calls
- [ ] 扩展 `LLMResponse` 接口支持 toolCalls、thinking
- [ ] 扩展 `LLMProviderConfig` 接口支持 tools、thinking、stream、onChunk
- [ ] 定义统一的 `ToolDefinition` 格式
- [ ] 定义 `StreamChunk` 接口

**文件：**
- `src/infra/llm/llm-provider.ts`

### Phase 2: Protocol Adapters 实现（6-8 小时）
- [ ] 实现 `AnthropicProtocol.formatToolsRequest()`
- [ ] 实现 `AnthropicProtocol.parseToolCallsResponse()`
- [ ] 实现 `AnthropicProtocol.parseStreamingChunk()` - 支持 thinking 和 tool_use
- [ ] 实现 `OpenAIProtocol.formatToolsRequest()`
- [ ] 实现 `OpenAIProtocol.parseToolCallsResponse()`
- [ ] 实现 `OpenAIProtocol.parseStreamingChunk()` - 支持 reasoning_content 和 tool_calls
- [ ] 实现 `GeminiProtocol.formatToolsRequest()`
- [ ] 实现 `GeminiProtocol.parseToolCallsResponse()`
- [ ] 实现 `GeminiProtocol.parseStreamingChunk()`

**文件：**
- `src/infra/llm/protocols/protocol-adapter.ts`
- `src/infra/llm/protocols/anthropic-protocol.ts`
- `src/infra/llm/protocols/openai-protocol.ts`
- `src/infra/llm/protocols/gemini-protocol.ts`

### Phase 3: UnifiedProvider 集成（3-4 小时）
- [ ] 修改 `UnifiedProvider.complete()` 传递工具定义
- [ ] 从 llm-config.json 读取模型的 thinking 和 streaming 配置
- [ ] 实现 streaming 模式的工具调用处理
- [ ] 处理工具调用响应（包含 thinking）
- [ ] 添加工具调用的错误处理和重试逻辑
- [ ] 实现 streaming 回调机制

**文件：**
- `src/infra/llm/provider-manager/unified-provider.ts`
- `src/infra/llm/provider-manager/types.ts`

### Phase 4: LLM Service 层集成（2-3 小时）
- [ ] 修改 `LLMService.completeWithTier()` 支持传递工具
- [ ] 添加工具调用的 tier 选择逻辑
- [ ] 支持 streaming 选项传递

**文件：**
- `src/infra/llm/llm-service.ts`

### Phase 5: Tool Provider 集成（2-3 小时）
- [ ] 实现 `ToolProvider.getToolDefinitions()` 返回 JSON Schema 格式
- [ ] 从现有的 `ToolRegistry` 生成 `ToolDefinition`
- [ ] 添加工具参数验证逻辑
- [ ] 为每个工具生成完整的 JSON Schema

**文件：**
- `src/infra/tools/tool-provider.ts`
- `src/infra/tools/tool-registry.ts`

### Phase 6: ReAct Integration 重构（4-5 小时）
- [ ] 移除 JSON 解析逻辑
- [ ] 使用原生 tool calls
- [ ] 实现工具执行循环
- [ ] 添加工具结果反馈机制
- [ ] 支持 streaming 模式（实时显示 thinking 和工具调用）
- [ ] 记录和显示 thinking 过程

**文件：**
- `src/autonomy/react-integration.ts`

### Phase 7: Response Generator 重构（3-4 小时）
- [ ] 添加工具调用支持
- [ ] 实现简单的 ReAct 循环
- [ ] 处理工具调用结果
- [ ] 支持 streaming 响应
- [ ] 显示 thinking 过程

**文件：**
- `src/app/conversation/response-generator.ts`

### Phase 8: 测试和验证（4-6 小时）
- [ ] 单元测试：Protocol Adapters（包含 streaming 和 thinking）
- [ ] 集成测试：完整的工具调用流程
- [ ] 端到端测试：Conversation phase 调用 web_search
- [ ] Streaming 测试：验证实时输出
- [ ] Thinking 测试：验证推理过程记录
- [ ] 性能测试：对比 JSON 解析方式

**文件：**
- `test/infra/llm/protocols/*.test.ts`
- `test/autonomy/react-integration.test.ts`
- `test/e2e/tool-calling.test.ts`
- `test/e2e/streaming-tool-calling.test.ts`

## 关键设计决策

### 1. 统一格式选择
采用 **OpenAI 风格的格式** 作为内部统一格式，因为：
- 最接近 JSON Schema 标准
- 大多数 provider 都支持类似格式
- 社区文档最丰富

### 2. 工具调用 ID 生成
- 使用 `crypto.randomUUID()` 生成唯一 ID
- 确保工具调用和结果能够匹配

### 3. 错误处理策略
- 工具调用失败 → 返回错误信息给 LLM
- LLM 可以选择重试或换其他方法
- 不自动 fallback，让 LLM 决策

### 4. 向后兼容
- 保留现有的 JSON 解析方式作为 fallback
- 通过配置开关控制是否启用原生 tool calling
- 逐步迁移现有代码

### 5. Thinking Mode 配置
- **默认行为**：如果模型支持 thinking（`llm-config.json` 中 `thinking: true`），则自动启用
- **用户控制**：可以在模型配置中设置 `thinking: false` 关闭
- **运行时覆盖**：调用时可以通过 `options.thinking` 覆盖配置
- **Fallback**：如果模型不支持，自动忽略该选项

### 6. Streaming 配置
- **默认行为**：如果模型支持 streaming（`llm-config.json` 中 `streaming: true`），则默认启用
- **用户控制**：可以在模型配置中设置 `streaming: false` 关闭
- **运行时覆盖**：调用时可以通过 `options.stream` 覆盖配置
- **回调机制**：通过 `options.onChunk` 接收实时数据

### 7. Streaming + Tool Calling 处理
- **累积工具参数**：streaming 模式下，工具参数可能分多个 chunk 返回，需要累积
- **完整性验证**：在 `done: true` 时验证工具调用的完整性
- **错误恢复**：如果 streaming 中断，尝试使用已接收的部分数据

### 8. Thinking 在 Streaming 中的处理
- **实时显示**：thinking 内容通过 `onChunk` 实时返回
- **分离存储**：thinking 和 content 分开存储和显示
- **调试价值**：thinking 对调试和理解 LLM 决策非常有价值

### 5. 工具结果反馈格式

不同 provider 对工具结果的处理方式不同：

**Anthropic:**
```typescript
{
  role: "user",
  content: [
    {
      type: "tool_result",
      tool_use_id: "toolu_xxx",
      content: "Result text"
    }
  ]
}
```

**OpenAI:**
```typescript
{
  role: "tool",
  tool_call_id: "call_xxx",
  content: "Result text"
}
```

**Gemini:**
```typescript
{
  role: "function",
  parts: [
    {
      functionResponse: {
        name: "web_search",
        response: { result: "Result text" }
      }
    }
  ]
}
```

## 风险和缓解措施

### 风险 1：不同 provider 的工具调用行为差异
**缓解**：
- 在 protocol adapter 层统一行为
- 添加详细的集成测试
- 文档化已知差异

### 风险 2：破坏现有功能
**缓解**：
- 使用 feature flag 控制新功能
- 保留旧代码作为 fallback
- 充分的回归测试

### 风险 3：性能问题
**缓解**：
- 工具定义缓存
- 避免重复序列化
- 性能监控和优化

### 风险 4：工具调用循环控制
**缓解**：
- 设置最大工具调用次数（如 10 次）
- 检测循环调用模式
- 提供紧急停止机制

## 成功标准

1. ✅ Conversation phase 能够调用 web_search 查询天气
2. ✅ 支持 Anthropic、OpenAI、Gemini 三种 provider
3. ✅ 工具调用成功率 > 95%
4. ✅ 响应时间 < 3 秒（单次工具调用）
5. ✅ Streaming 模式下实时显示 thinking 和工具调用
6. ✅ Thinking mode 正确记录和显示推理过程
7. ✅ 所有现有测试通过
8. ✅ 新增测试覆盖率 > 80%
9. ✅ 用户可以通过 llm-config.json 控制 thinking 和 streaming

## 预估时间

- **Phase 1**: 2-3 小时
- **Phase 2**: 6-8 小时（增加了 streaming 和 thinking 支持）
- **Phase 3**: 3-4 小时（增加了 streaming 处理）
- **Phase 4**: 2-3 小时
- **Phase 5**: 2-3 小时
- **Phase 6**: 4-5 小时（增加了 streaming 和 thinking 显示）
- **Phase 7**: 3-4 小时（增加了 streaming 支持）
- **Phase 8**: 4-6 小时

**总计**：26-36 小时

**分阶段交付**：每个 Phase 完成后可以验证
**最小可用版本**：Phase 1-5 完成后即可使用（约 15-21 小时）
**完整功能版本**：Phase 1-7 完成（约 22-30 小时）

## 文件修改清单

### 核心接口（1 个文件）
1. `src/infra/llm/llm-provider.ts` - 扩展接口

### Protocol Layer（4 个文件）
2. `src/infra/llm/protocols/protocol-adapter.ts` - 添加工具相关接口
3. `src/infra/llm/protocols/anthropic-protocol.ts` - 实现 Anthropic 工具格式
4. `src/infra/llm/protocols/openai-protocol.ts` - 实现 OpenAI 工具格式
5. `src/infra/llm/protocols/gemini-protocol.ts` - 实现 Gemini 工具格式

### Provider Layer（2 个文件）
6. `src/infra/llm/provider-manager/unified-provider.ts` - 传递工具定义
7. `src/infra/llm/llm-service.ts` - 支持工具参数

### Tool Layer（2 个文件）
8. `src/infra/tools/tool-provider.ts` - 生成 ToolDefinition
9. `src/infra/tools/tool-registry.ts` - 工具元数据

### Application Layer（2 个文件）
10. `src/autonomy/react-integration.ts` - 使用原生 tool calling
11. `src/app/conversation/response-generator.ts` - 添加工具调用循环

### Tests（3+ 个文件）
12. `test/infra/llm/protocols/tool-calling.test.ts` - 新增
13. `test/autonomy/react-integration.test.ts` - 修改
14. `test/e2e/tool-calling.test.ts` - 新增

**总计：14 个文件（11 个修改，3 个新增）**

## 实现优先级

### P0 - 核心功能（必须完成）
- Phase 1: 核心接口扩展
- Phase 2: Protocol Adapters（至少 Anthropic）
- Phase 5: Tool Provider 集成
- Phase 7: Response Generator 重构

### P1 - 完整支持（高优先级）
- Phase 2: 其他 Protocol Adapters（OpenAI, Gemini）
- Phase 3: UnifiedProvider 集成
- Phase 6: ReAct Integration 重构

### P2 - 优化和测试（中优先级）
- Phase 4: LLM Service 层集成
- Phase 8: 测试和验证

## 下一步行动

1. 确认设计方案
2. 开始 Phase 1：核心接口扩展
3. 实现 Phase 2：Anthropic Protocol Adapter
4. 验证基本的工具调用流程
5. 逐步完成其他 phases
