# 长上下文记忆维持机制 (Long Context Memory)

## 核心挑战

LLM存在上下文窗口限制（如GPT-4: ~128K tokens, Claude-3: ~200K tokens）。OpenClaw通过**Hybrid Memory Architecture**突破这一限制。

## 双层记忆架构

### Layer 1: Session History（短期记忆）

**存储**: JSON/JSON5文件 (`~/.openclaw/sessions/{sessionId}.json`)

**特点**:
- **完整对话历史**: 所有User/Assistant消息
- **工具调用记录**: 包含输入输出
- **Token估算**: 使用 `estimateTokens()` 实时计算

**Compaction触发条件**:
1.  **Token超限**: 当前上下文超过模型窗口的 80%
2.  **API错误**: 收到 `context_length_exceeded` 错误
3.  **手动触发**: 用户发送 `/compact` 命令

### Layer 2: Vector Memory（长期记忆）

**存储**: SQLite + `sqlite-vec` extension

**工作流程**:
```
1. 文件/代码 Indexing
   └─> Chunking (按行/Token分块)
       └─> Embedding Generation (调用LLM API)
           └─> Store in `chunks` table

2. Query-time Retrieval
   └─> Query Embedding
       └─> Vector Similarity Search (Cosine Distance)
           └─> Top-K Results
               └─> Inject into Prompt
```

## Session Compaction 详解

**位置**: `src/agents/compaction.ts`

### Compaction算法

**Multi-Part Summarization**:

```
原始历史 (N条消息, 估算: 50K tokens)
    |
    v
按Token均分为 P 部分 (默认 P=2)
    |
    v
对每部分并发调用LLM生成摘要
    |
    v
合并摘要 (如果摘要仍过长，递归重复)
    |
    v
最终压缩结果 (约: 5-10K tokens)
```

**关键参数**:
- `BASE_CHUNK_RATIO = 0.4`: 目标压缩率（40%）
- `MIN_CHUNK_RATIO = 0.15`: 最小压缩率（15%）
- `SAFETY_MARGIN = 1.2`: Token估算误差缓冲（20%）

### 信息保留策略

**高优先级保留**:
- ✅ 明确的决策和结论
- ✅ 待办事项 (TODOs)
- ✅ 开放性问题
- ✅ 约束条件和限制

**可丢弃信息**:
- ❌ 中间探索过程
- ❌ 重复的澄清
- ❌ 临时性的状态

### Compaction触发时机

**实现位置**: `src/agents/context-window-guard.ts`

```typescript
function shouldCompact(messages, modelMaxTokens): boolean {
  const estimated = estimateMessagesTokens(messages);
  const threshold = modelMaxTokens * 0.8;  // 80% 阈值
  return estimated > threshold;
}
```

## Token 估算机制

**实现**: `@mariozechner/pi-coding-agent` library

**估算算法** (简化版):
```javascript
function estimateTokens(message) {
  let count = 0;
  
  // 文本内容 (粗略: 1 token ≈ 4 characters)
  count += message.text.length / 4;
  
  // 工具调用 (结构化开销)
  count += message.toolCalls.length * 50;
  
  // 思考内容 (Claude thinking)
  count += message.thinking ? message.thinking.length / 4 : 0;
  
  return Math.ceil(count);
}
```

**注意**: 这是粗略估算，实际Token数可能偏差±20%。

## Memory (RAG) Integration

### 自动触发条件

**位置**: `src/agents/memory-search.ts`

当用户提问**明确引用**文件/代码时，自动触发Memory检索：
- "打开 `server.ts` 文件"
- "参考之前的 API 文档"
- "/context 项目结构"

### 检索流程

```
1. Parse User Query
   └─> 提取关键词和文件路径
       |
2. Generate Query Embedding
   └─> 调用LLM Embedding API
       |
3. Vector Search (Cosine Similarity)
   └─> SELECT * FROM chunks 
       WHERE cosine_distance(embedding, query_embedding) < threshold
       ORDER BY distance ASC
       LIMIT 10
       |
4. Re-rank Results
   └─> 基于 source、文件路径、时间戳等二次排序
       |
5. Inject into Prompt
   └─> 作为 <context> 块添加到System Prompt
```

### Embedding Cache

**表**: `embedding_cache`

**策略**:
- **Key**: `(provider, model, hash)`
- **TTL**: 无过期时间（永久缓存）
- **Invalidation**: 文件内容变化时，hash改变，自动失效

**成本优化**:
- 相同文本只调用一次Embedding API
- 跨Session共享缓存
- 减少90%+ 的Embedding API调用

## 上下文窗口动态调整

### 模型检测

**位置**: `src/agents/model-selection.ts`

系统自动检测模型的最大窗口：
```typescript
const MODEL_LIMITS = {
  "claude-opus-4-5": 200000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,
  // ...
};
```

### 自适应策略

| 模型窗口 | History Limit | Compaction频率 |
| :--- | :--- | :--- |
| < 16K | 20条消息 | 每5-10轮对话 |
| 16K-64K | 50条消息 | 每20-30轮对话 |
| 64K-128K | 100条消息 | 每50轮对话 |
| > 128K | 200条消息 | 很少触发 |

## 故障恢复

### Compaction失败处理

**场景**: LLM API调用失败

**降级策略**:
1.  **Retry**: 最多重试3次
2.  **Fallback Model**: 切换到更便宜的模型（如Claude Haiku）
3.  **Manual Truncation**: 如果仍失败，强制截断历史（保留最近N条）

### Token估算误差

**问题**: 实际Token数超过估算值

**缓解**:
- `SAFETY_MARGIN = 1.2`: 预留20%缓冲
- Catch `context_length_exceeded` 异常，自动触发紧急Compaction
