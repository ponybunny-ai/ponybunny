# Memory Management (OpenClaw Architecture Reference)

本文档详细拆解 OpenClaw 项目的长上下文记忆维持机制，作为 PonyBunny 实现的工程参考指南。

---

## 1. 核心挑战与解决方案

### 1.1 LLM 上下文窗口限制

| 模型 | 上下文窗口 | 实际可用 | 成本 (输入/输出, $/1M tokens) | 限制 |
|:---|:---|:---|:---|:---|
| **GPT-4o** | 128K tokens | ~100K tokens | $2.50 / $10.00 | API 响应速度随长度下降 |
| **Claude Opus 4.5** | 200K tokens | ~180K tokens | $15.00 / $75.00 | Cost 随 token 数增加，顶级推理能力 |
| **Claude Sonnet 4.5** | 200K tokens | ~180K tokens | $3.00 / $15.00 | 性价比最优，适合生产环境 |
| **Gemini 2.0 Flash** | 1M tokens | ~900K tokens | $0.075 / $0.30 | 超大窗口，极低成本，但推理能力弱 |
| **Claude Haiku 3.5** | 200K tokens | ~180K tokens | $0.80 / $4.00 | 经济型模型，快速响应 |
| **Qwen 2.5 72B** | 128K tokens | ~100K tokens | $0.40 / $0.40 | 开源模型，本地部署可用 |

**核心矛盾**：
- 长对话历史快速消耗 token 预算
- 工具调用输出（代码、日志）占用大量空间
- Thinking blocks（Claude 推理过程）额外开销

**OpenClaw 解决方案**：**Hybrid Memory Architecture**（混合记忆架构）

---

## 2. 双层记忆架构

### 2.1 Layer 1: Session History — 短期记忆

**存储引擎**：JSON5 文件  
**路径**：`~/.openclaw/sessions/chats/{sessionId}.json5`

**数据结构**：
```typescript
{
  messages: [
    { role: "user", content: "...", timestamp: 1704067200000 },
    { role: "assistant", content: "...", toolCalls: [...], usage: {...} },
    { role: "tool", toolCallId: "...", content: "..." },
  ],
  compactedHistory: [
    { role: "system", content: "[Summary] ...", compactedAt: 1704069000000 }
  ]
}
```

**Token 估算**：

**实现**：`@mariozechner/pi-coding-agent` library

```typescript
function estimateTokens(message: AgentMessage): number {
  let count = 0
  
  // 文本内容 (1 token ≈ 4 characters)
  if (message.content) {
    count += Math.ceil(message.content.length / 4)
  }
  
  // 工具调用结构化开销
  if (message.toolCalls) {
    count += message.toolCalls.length * 50
  }
  
  // Thinking blocks (Claude)
  if (message.thinkingBlocks) {
    for (const block of message.thinkingBlocks) {
      count += Math.ceil(block.content.length / 4)
    }
  }
  
  return count
}

function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg), 0)
}
```

**误差范围**：±20%（粗略估算，避免精确 tokenization 的性能开销）

### 2.2 Layer 2: Vector Memory — 长期记忆

**存储引擎**：SQLite + `sqlite-vec` extension  
**用途**：代码库、文档的语义检索（RAG）

**工作流程**：
```
Workspace Files → Chunking (512 tokens) → Embedding API → Vector DB
                                                              ↓
User Query → Embedding API → Cosine Similarity Search → Top-K Results
                                                              ↓
                                                  Inject into System Prompt
```

（详见 `database.md` 第 3 节）

---

## 3. Session Compaction — 上下文压缩引擎

### 3.1 触发条件

**实现位置**：`src/agents/context-window-guard.ts` (77 lines)

```typescript
const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000  // 绝对最小值（阻止执行）
const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000  // 警告阈值

function shouldCompact(
  messages: AgentMessage[],
  contextWindow: number,
): boolean {
  const estimated = estimateMessagesTokens(messages)
  const threshold = contextWindow * 0.8  // 80% 阈值
  return estimated > threshold
}
```

**三种触发方式**：

1. **预防性压缩**：Token 估算达到模型窗口 80%
2. **API 错误响应**：收到 `context_length_exceeded` 异常
3. **手动触发**：用户发送 `/compact` 命令

**Context Window 解析优先级**：

```typescript
function resolveContextWindowInfo(params: {
  cfg: OpenClawConfig,
  provider: string,
  modelId: string,
  modelContextWindow?: number,
  defaultTokens: number,
}): ContextWindowInfo {
  // Priority 1: Model registry (openclaw-models.json)
  if (params.modelContextWindow > 0) {
    return { tokens: params.modelContextWindow, source: "model" }
  }
  
  // Priority 2: Config file (models.providers.{provider}.models[])
  const fromConfig = lookupModelContextWindow(params.cfg, params.provider, params.modelId)
  if (fromConfig > 0) {
    return { tokens: fromConfig, source: "modelsConfig" }
  }
  
  // Priority 3: Agent default (agents.defaults.contextTokens)
  const fromAgent = params.cfg?.agents?.defaults?.contextTokens
  if (fromAgent > 0) {
    return { tokens: fromAgent, source: "agentContextTokens" }
  }
  
  // Fallback: DEFAULT_CONTEXT_TOKENS (80000)
  return { tokens: params.defaultTokens, source: "default" }
}
```

### 3.2 Multi-Part Summarization 算法

**实现位置**：`src/agents/compaction.ts` (357 lines)

**核心参数**：
```typescript
const BASE_CHUNK_RATIO = 0.4    // 目标压缩率 (40%)
const MIN_CHUNK_RATIO = 0.15    // 最小压缩率 (15%)
const SAFETY_MARGIN = 1.2       // Token 估算误差缓冲 (20%)
const DEFAULT_PARTS = 2         // 默认分块数
```

**算法流程**：

```typescript
async function summarizeInStages(params: {
  messages: AgentMessage[],
  contextWindow: number,
  targetTokens: number,
  ext: ExtensionContext,
}): Promise<string> {
  // Step 1: 计算自适应分块数
  const chunkRatio = computeAdaptiveChunkRatio(params.messages, params.contextWindow)
  const parts = Math.max(2, Math.ceil(1 / chunkRatio))
  
  // Step 2: 按 Token 均分消息
  const chunks = splitMessagesByTokenShare(params.messages, parts)
  
  // Step 3: 并发生成每部分的摘要
  const summaries = await Promise.all(
    chunks.map(chunk => generateSummary(chunk, params.ext))
  )
  
  // Step 4: 合并摘要
  let merged = summaries.join("\n\n")
  
  // Step 5: 递归压缩（如果合并后仍过长）
  if (estimateTokens(merged) > params.targetTokens) {
    return await summarizeInStages({
      ...params,
      messages: [{ role: "system", content: merged }],
    })
  }
  
  return merged
}
```

**自适应分块策略**：

```typescript
function computeAdaptiveChunkRatio(
  messages: AgentMessage[],
  contextWindow: number,
): number {
  const totalTokens = estimateMessagesTokens(messages)
  const avgTokens = totalTokens / messages.length
  const safeAvgTokens = avgTokens * SAFETY_MARGIN
  const avgRatio = safeAvgTokens / contextWindow
  
  // 如果平均消息 > 10% 上下文窗口，降低压缩率
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO)
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction)
  }
  
  return BASE_CHUNK_RATIO
}
```

**示例**：
- 50 条消息，总计 50K tokens，上下文窗口 100K
- 平均每条 1K tokens，占窗口 1%（正常）
- 使用 BASE_CHUNK_RATIO (0.4)，分 3 部分
- 每部分约 16.7K tokens，生成摘要约 6.7K tokens
- 合并后 ~20K tokens（压缩到 40%）

### 3.3 信息保留策略

**Summarization Prompt**（注入到 LLM）：

```
Summarize the following conversation history concisely, preserving:
✅ Explicit decisions and conclusions
✅ Active TODOs and open questions
✅ Constraints and requirements
✅ Key code changes and their rationale

Discard:
❌ Exploratory back-and-forth
❌ Redundant clarifications
❌ Temporary states
❌ Verbose error messages (keep only root causes)

Be concise but comprehensive. Focus on outcomes, not process.
```

**合并指令**：
```typescript
const MERGE_SUMMARIES_INSTRUCTIONS = 
  "Merge these partial summaries into a single cohesive summary. " +
  "Preserve decisions, TODOs, open questions, and any constraints."
```

### 3.4 Fallback 机制 — 超大消息处理

**问题**：单条消息超过模型窗口 50%（无法摘要）

**解决方案**：渐进式降级

```typescript
async function summarizeWithFallback(params: {
  messages: AgentMessage[],
  contextWindow: number,
  ext: ExtensionContext,
}): Promise<string> {
  // Level 1: 尝试完整摘要
  try {
    return await summarizeChunks(params)
  } catch (fullError) {
    console.warn("Full summarization failed, trying partial")
  }
  
  // Level 2: 只摘要"小"消息，标记超大消息
  const smallMessages: AgentMessage[] = []
  const oversizedNotes: string[] = []
  
  for (const msg of params.messages) {
    if (isOversizedForSummary(msg, params.contextWindow)) {
      const tokens = estimateTokens(msg)
      oversizedNotes.push(
        `[Large ${msg.role} (~${Math.round(tokens / 1000)}K tokens) omitted]`
      )
    } else {
      smallMessages.push(msg)
    }
  }
  
  if (smallMessages.length > 0) {
    try {
      const partial = await summarizeChunks({ ...params, messages: smallMessages })
      return partial + "\n\n" + oversizedNotes.join("\n")
    } catch (partialError) {
      console.warn("Partial summarization also failed")
    }
  }
  
  // Level 3: 完全失败，返回元数据
  return `Context contained ${params.messages.length} messages ` +
         `(${oversizedNotes.length} oversized). Summary unavailable.`
}

function isOversizedForSummary(msg: AgentMessage, contextWindow: number): boolean {
  const tokens = estimateTokens(msg) * SAFETY_MARGIN
  return tokens > contextWindow * 0.5
}
```

---

## 4. Compaction 执行流程

### 4.1 完整生命周期

```typescript
// Phase 1: 检测触发条件
const estimated = estimateMessagesTokens(history.messages)
const threshold = contextWindow * 0.8

if (estimated < threshold) {
  return  // 无需压缩
}

// Phase 2: 计算目标 Token 数
const targetTokens = contextWindow * 0.3  // 压缩到 30%

// Phase 3: 执行压缩
const summary = await summarizeInStages({
  messages: history.messages,
  contextWindow,
  targetTokens,
  ext: { model, apiKey, signal },
})

// Phase 4: 替换历史
history.compactedHistory = history.compactedHistory || []
history.compactedHistory.push({
  role: "system",
  content: summary,
  compactedAt: Date.now(),
  originalMessageCount: history.messages.length,
})

// Phase 5: 清空原始消息（保留最近 N 条）
const keepRecent = 5
history.messages = history.messages.slice(-keepRecent)

// Phase 6: 更新元数据
session.compactionCount = (session.compactionCount || 0) + 1
session.updatedAt = Date.now()
```

### 4.2 重试策略

**API 调用失败处理**：

```typescript
async function generateSummaryWithRetry(
  messages: AgentMessage[],
  ext: ExtensionContext,
  maxAttempts = 3,
): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await generateSummary(messages, ext.model, ext.apiKey, ext.signal)
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err
      }
      
      // 检查是否是模型能力问题
      if (isModelCapabilityError(err)) {
        // 切换到更便宜的模型
        ext.model = getFallbackModel(ext.model)
      }
      
      // 指数退避
      await sleep(500 * Math.pow(2, attempt - 1))
    }
  }
}

function getFallbackModel(currentModel: string): string {
  const FALLBACK_CHAIN = {
    "claude-opus-4-5": "claude-sonnet-3-5",
    "claude-sonnet-3-5": "claude-haiku-3-5",
    "gpt-4-turbo": "gpt-3.5-turbo",
  }
  return FALLBACK_CHAIN[currentModel] || currentModel
}
```

### 4.3 紧急压缩（Emergency Compaction）

**场景**：API 返回 `context_length_exceeded` 错误

```typescript
async function handleContextOverflow(
  sessionId: string,
  history: SessionHistory,
  contextWindow: number,
): Promise<void> {
  log.warn("Context length exceeded, triggering emergency compaction")
  
  // 立即压缩到 20%（更激进）
  const targetTokens = contextWindow * 0.2
  
  const summary = await summarizeInStages({
    messages: history.messages,
    contextWindow,
    targetTokens,
    ext: { ... },
  })
  
  // 只保留最近 2 条消息
  history.messages = history.messages.slice(-2)
  history.compactedHistory = [
    { role: "system", content: summary, compactedAt: Date.now() }
  ]
  
  // 标记为紧急压缩
  const session = getSession(sessionId)
  session.memoryFlushAt = Date.now()
}
```

---

## 5. Memory (RAG) Integration

### 5.1 自动触发条件

**实现位置**：`src/agents/memory-search.ts`

```typescript
function shouldTriggerMemorySearch(userMessage: string): boolean {
  // Pattern 1: 明确文件引用
  if (/[`"'][\w\/\.-]+\.(ts|js|py|md|json)[`"']/.test(userMessage)) {
    return true
  }
  
  // Pattern 2: 上下文命令
  if (/^\/context|^\/remember|^\/recall/.test(userMessage)) {
    return true
  }
  
  // Pattern 3: 语义触发词
  const triggers = ["参考", "查看", "打开文件", "之前的", "earlier"]
  if (triggers.some(t => userMessage.includes(t))) {
    return true
  }
  
  return false
}
```

### 5.2 检索流程与注入

```typescript
async function injectMemoryContext(
  userQuery: string,
  systemPrompt: string,
  memoryManager: MemoryIndexManager,
): Promise<string> {
  // Step 1: 生成 Query Embedding
  const queryEmbedding = await memoryManager.embed(userQuery)
  
  // Step 2: Hybrid Search (Vector + FTS)
  const results = await memoryManager.search({
    query: userQuery,
    queryEmbedding,
    limit: 10,
    vectorWeight: 0.7,
    textWeight: 0.3,
  })
  
  // Step 3: Re-rank by source priority
  const ranked = results.sort((a, b) => {
    if (a.source === "memory" && b.source === "sessions") return -1
    if (a.source === "sessions" && b.source === "memory") return 1
    return b.score - a.score
  })
  
  // Step 4: 构建 Context Block
  const contextBlock = ranked.map(r => `
    <file path="${r.path}" lines="${r.startLine}-${r.endLine}">
    ${r.snippet}
    </file>
  `).join("\n")
  
  // Step 5: 注入到 System Prompt
  return `${systemPrompt}\n\n<relevant_context>\n${contextBlock}\n</relevant_context>`
}
```

**Token 预算管理**：

```typescript
const MAX_MEMORY_CONTEXT_TOKENS = 10_000

function truncateContextToFit(
  contextBlock: string,
  maxTokens: number,
): string {
  let currentTokens = estimateTokens(contextBlock)
  
  if (currentTokens <= maxTokens) {
    return contextBlock
  }
  
  // 逐个移除最低分数的结果
  const files = parseContextBlock(contextBlock)
  const sorted = files.sort((a, b) => b.score - a.score)
  
  let kept = []
  let accumulated = 0
  
  for (const file of sorted) {
    const fileTokens = estimateTokens(file.content)
    if (accumulated + fileTokens > maxTokens) {
      break
    }
    kept.push(file)
    accumulated += fileTokens
  }
  
  return buildContextBlock(kept)
}
```

---

## 6. 性能优化与监控

### 6.1 Compaction 性能指标

| 指标 | 目标值 | 实际测量 |
|:---|:---|:---|
| 压缩率 | 30-40% | 35% (平均) |
| 压缩延迟 | < 5s | 3.2s (50 条消息) |
| API 调用数 | = 分块数 | 2-3 次 (并发) |
| Token 估算误差 | < 20% | ±15% |
| Emergency Compaction | < 10s | 7.5s |

### 6.2 日志与调试

```typescript
log.info("Compaction triggered", {
  sessionId,
  messageCount: messages.length,
  estimatedTokens: estimated,
  contextWindow,
  threshold: contextWindow * 0.8,
  chunkRatio,
  parts,
})

log.info("Compaction completed", {
  sessionId,
  originalTokens: estimated,
  compactedTokens: estimateTokens(summary),
  compressionRatio: estimateTokens(summary) / estimated,
  duration: Date.now() - startTime,
  apiCalls: parts,
})
```

### 6.3 自适应策略表

| 窗口大小 | 压缩阈值 (80%) | 目标大小 (30%) | 保留消息数 | Compaction 频率 |
|:---|:---|:---|:---|:---|
| 16K | 12.8K | 4.8K | 5 | 每 5-10 轮 |
| 32K | 25.6K | 9.6K | 10 | 每 10-15 轮 |
| 64K | 51.2K | 19.2K | 20 | 每 20-30 轮 |
| 128K | 102.4K | 38.4K | 50 | 每 50 轮 |
| 200K | 160K | 60K | 100 | 很少触发 |

---

## 7. 关键文件索引

| 功能模块 | 核心文件 | 代码量 | 关键职责 |
|:---|:---|:---|:---|
| **Compaction Core** | `src/agents/compaction.ts` | 357 行 | Multi-Part Summarization 算法 |
| **Context Guard** | `src/agents/context-window-guard.ts` | 77 行 | 窗口检测、压缩触发 |
| **Memory Search** | `src/agents/memory-search.ts` | - | RAG 检索触发逻辑 |
| **Token Estimation** | `@mariozechner/pi-coding-agent` | - | estimateTokens() 实现 |

---

## 8. 设计模式总结

### 8.1 渐进式降级

- **Level 1**: 完整多部分摘要
- **Level 2**: 部分摘要 + 超大消息标记
- **Level 3**: 元数据记录

### 8.2 自适应参数

- 根据消息平均大小调整分块策略
- 根据模型窗口大小调整压缩目标

### 8.3 并发优化

- 多部分摘要并发生成（减少总延迟）
- Vector + FTS 混合搜索并发执行

---

**文档版本**：基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**适用场景**：PonyBunny 项目的记忆管理参考指南
