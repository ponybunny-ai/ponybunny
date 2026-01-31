# Database & Data Model (OpenClaw Architecture Reference)

本文档详细拆解 OpenClaw 项目的数据存储架构，作为 PonyBunny 实现的工程参考指南。

---

## 1. Dual Store Architecture — 双存储架构

OpenClaw 采用 **双存储体系**，将不同类型的数据分配到最适合的存储引擎：

| 存储类型 | 引擎 | 数据类型 | 优化目标 |
|:---|:---|:---|:---|
| **Session Store** | JSON5 文件 | 会话历史、元数据 | 人类可读、可移植、版本控制友好 |
| **Memory Index** | SQLite + 扩展 | 向量嵌入、全文索引 | 高性能检索、低延迟查询 |

### 1.1 设计原则

- **读写分离**：Session 频繁更新（每次对话），Memory 批量更新（索引构建）
- **格式优化**：JSON5 便于手动编辑和调试，SQLite 提供结构化查询
- **容错性**：JSON 文件损坏只影响单个会话，SQLite 损坏可通过 WAL 日志恢复

---

## 2. SQLite Schema — Memory Index 数据库

### 2.1 核心表结构

**实现位置**：`src/memory/memory-schema.ts` (97 lines)

**默认路径**：`~/.openclaw/memory.db`

#### Table: `meta` — 数据库元数据

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**用途**：
- 存储 schema 版本（`memory_index_meta_v1`）
- 记录 embedding 配置（provider、model、dims）
- 追踪迁移状态

**关键记录示例**：
```json
{
  "key": "memory_index_meta_v1",
  "value": "{\"model\":\"text-embedding-3-small\",\"provider\":\"openai\",\"chunkTokens\":512,\"chunkOverlap\":50,\"vectorDims\":1536}"
}
```

#### Table: `files` — 索引文件追踪

```sql
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',  -- 'memory' | 'sessions'
  hash TEXT NOT NULL,                      -- SHA256 of file content
  mtime INTEGER NOT NULL,                  -- Unix timestamp (ms)
  size INTEGER NOT NULL                    -- File size in bytes
);
```

**用途**：
- 检测文件变化（通过 `hash` 和 `mtime` 对比）
- 增量索引决策（只重新索引已修改文件）
- 区分数据源（workspace 文件 vs session transcripts）

**增量索引算法**：
```typescript
async function shouldReindex(file: FileEntry, db: DatabaseSync): Promise<boolean> {
  const existing = db.prepare("SELECT hash, mtime FROM files WHERE path = ?").get(file.path)
  
  if (!existing) {
    return true  // 新文件，需要索引
  }
  
  // 比较 hash 和 mtime
  if (existing.hash !== file.hash || existing.mtime !== file.mtime) {
    return true  // 文件已修改
  }
  
  return false  // 文件未变化，跳过
}
```

#### Table: `chunks` — 文本块与嵌入

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,                     -- UUID
  path TEXT NOT NULL,                      -- File path (FK to files.path)
  source TEXT NOT NULL DEFAULT 'memory',   -- 'memory' | 'sessions'
  start_line INTEGER NOT NULL,             -- Chunk start line number
  end_line INTEGER NOT NULL,               -- Chunk end line number
  hash TEXT NOT NULL,                      -- SHA256 of chunk text
  model TEXT NOT NULL,                     -- e.g., 'openai/text-embedding-3-small'
  text TEXT NOT NULL,                      -- Chunk content
  embedding TEXT NOT NULL,                 -- JSON array or Blob
  updated_at INTEGER NOT NULL              -- Unix timestamp (ms)
);

CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
```

**设计要点**：
- **分块策略**：按行数或 Token 数切分（默认 512 tokens，50 tokens overlap）
- **Embedding 存储**：JSON 字符串（fallback）或 Blob（`sqlite-vec` 可用时）
- **模型锁定**：`model` 字段确保不混用不同模型的 embedding

**Chunking 算法示例**（Markdown 文件）：
```typescript
function chunkMarkdown(content: string, chunkTokens: number, overlap: number): Chunk[] {
  const lines = content.split('\n')
  const chunks: Chunk[] = []
  let currentChunk: string[] = []
  let currentTokens = 0
  
  for (let i = 0; i < lines.length; i++) {
    const lineTokens = estimateTokens(lines[i])
    
    if (currentTokens + lineTokens > chunkTokens && currentChunk.length > 0) {
      // 达到块大小，保存当前块
      chunks.push({
        startLine: i - currentChunk.length,
        endLine: i - 1,
        text: currentChunk.join('\n'),
      })
      
      // 保留 overlap 行到下一个块
      const overlapLines = Math.floor(overlap / (currentTokens / currentChunk.length))
      currentChunk = currentChunk.slice(-overlapLines)
      currentTokens = currentChunk.reduce((sum, line) => sum + estimateTokens(line), 0)
    }
    
    currentChunk.push(lines[i])
    currentTokens += lineTokens
  }
  
  if (currentChunk.length > 0) {
    chunks.push({
      startLine: lines.length - currentChunk.length,
      endLine: lines.length - 1,
      text: currentChunk.join('\n'),
    })
  }
  
  return chunks
}
```

#### Table: `embedding_cache` — Embedding API 缓存

```sql
CREATE TABLE IF NOT EXISTS embedding_cache (
  provider TEXT NOT NULL,        -- 'openai' | 'gemini' | 'local'
  model TEXT NOT NULL,           -- Model ID
  provider_key TEXT NOT NULL,    -- API key hash (for multi-account)
  hash TEXT NOT NULL,            -- SHA256 of input text
  embedding TEXT NOT NULL,       -- Cached embedding vector
  dims INTEGER,                  -- Vector dimensions
  updated_at INTEGER NOT NULL,   -- Cache timestamp
  PRIMARY KEY (provider, model, provider_key, hash)
);

CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at 
  ON embedding_cache(updated_at);
```

**缓存策略**：
- **Key 设计**：`(provider, model, provider_key, hash)` 四元组确保唯一性
- **命中率**：对于相同文件的重复索引，缓存命中率 > 90%
- **无过期时间**：永久缓存（直到手动清理）
- **成本节省**：避免重复调用 Embedding API

**Cache Lookup 流程**：
```typescript
async function getEmbeddingWithCache(
  text: string,
  provider: string,
  model: string,
  providerKey: string,
  db: DatabaseSync,
): Promise<number[]> {
  const textHash = crypto.createHash('sha256').update(text).digest('hex')
  
  // 尝试缓存查询
  const cached = db.prepare(`
    SELECT embedding FROM embedding_cache
    WHERE provider = ? AND model = ? AND provider_key = ? AND hash = ?
  `).get(provider, model, providerKey, textHash)
  
  if (cached) {
    return JSON.parse(cached.embedding)  // 缓存命中
  }
  
  // 缓存未命中，调用 API
  const embedding = await callEmbeddingAPI(text, provider, model)
  
  // 写入缓存
  db.prepare(`
    INSERT OR REPLACE INTO embedding_cache 
      (provider, model, provider_key, hash, embedding, dims, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    provider,
    model,
    providerKey,
    textHash,
    JSON.stringify(embedding),
    embedding.length,
    Date.now()
  )
  
  return embedding
}
```

#### Virtual Table: `chunks_fts` — 全文搜索索引（FTS5）

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,                    -- Full-text indexed content
  id UNINDEXED,           -- Chunk ID (not indexed)
  path UNINDEXED,         -- File path (not indexed)
  source UNINDEXED,       -- Data source (not indexed)
  model UNINDEXED,        -- Embedding model (not indexed)
  start_line UNINDEXED,   -- Start line (not indexed)
  end_line UNINDEXED      -- End line (not indexed)
);
```

**FTS5 特性**：
- **BM25 排序**：SQLite 内置的相关性算法
- **AND/OR 查询**：支持布尔逻辑
- **前缀匹配**：`term*` 语法
- **UNINDEXED 字段**：减少索引大小，提升写入性能

**FTS Query 转换示例**：
```typescript
function buildFtsQuery(rawQuery: string): string | null {
  // 提取关键词
  const tokens = rawQuery
    .match(/[A-Za-z0-9_]+/g)
    ?.map(t => t.trim())
    .filter(Boolean) ?? []
  
  if (tokens.length === 0) {
    return null
  }
  
  // 转换为 FTS5 语法（AND 连接，引号包裹）
  const quoted = tokens.map(t => `"${t.replaceAll('"', '')}"`)
  return quoted.join(" AND ")
  
  // 示例输入: "user authentication JWT"
  // 输出: "user" AND "authentication" AND "JWT"
}
```

#### Virtual Table: `chunks_vec` — 向量相似度搜索（sqlite-vec）

**注意**：此表由 `sqlite-vec` 扩展动态创建，不在 `memory-schema.ts` 中定义。

```sql
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]  -- Dimensions depend on model
);
```

**`sqlite-vec` 扩展加载**：

**实现位置**：`src/memory/sqlite-vec.ts` (25 lines)

```typescript
import { getLoadablePath, load } from 'sqlite-vec'

async function loadSqliteVecExtension(
  db: DatabaseSync,
  extensionPath?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resolvedPath = extensionPath || getLoadablePath()
    
    db.enableLoadExtension(true)
    if (extensionPath) {
      db.loadExtension(resolvedPath)
    } else {
      load(db)  // 使用 npm package 自带的 extension
    }
    
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

**Fallback 机制**：
- **Native Extension 可用**：使用 `vec_distance_cosine()` SQL 函数（高性能）
- **Extension 加载失败**：降级到 JavaScript 实现（低性能但兼容性强）

```typescript
// Fallback: JavaScript cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}
```

---

## 3. Hybrid Search — 向量 + 全文混合检索

### 3.1 搜索架构

**实现位置**：
- `src/memory/manager-search.ts` — 向量搜索
- `src/memory/hybrid.ts` (115 lines) — 混合结果合并

```
User Query: "How does authentication work?"
          ↓
    ┌─────┴─────┐
    │           │
[Vector]    [Keyword]
  Branch      Branch
    │           │
    v           v
Generate     Tokenize
Embedding    → FTS5
    │           │
    v           v
sqlite-vec   SELECT ... FROM chunks_fts
cosine       WHERE chunks_fts MATCH ?
distance     ORDER BY bm25(chunks_fts)
    │           │
    v           v
Top-K        Top-K
(scored)     (scored)
    │           │
    └─────┬─────┘
          v
   Merge with
   weighted sum
          v
   Final Results
   (sorted by score)
```

### 3.2 向量搜索实现

```typescript
async function searchVector(params: {
  db: DatabaseSync,
  queryVec: number[],
  limit: number,
  providerModel: string,
}): Promise<SearchResult[]> {
  // 使用 sqlite-vec 扩展
  const rows = params.db.prepare(`
    SELECT c.id, c.path, c.start_line, c.end_line, c.text, c.source,
           vec_distance_cosine(v.embedding, ?) AS dist
      FROM chunks_vec v
      JOIN chunks c ON c.id = v.id
     WHERE c.model = ?
     ORDER BY dist ASC
     LIMIT ?
  `).all(
    vectorToBlob(params.queryVec),  // Float32Array → Buffer
    params.providerModel,
    params.limit
  )
  
  return rows.map(row => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    score: 1 - row.dist,  // 距离转相似度
    snippet: row.text.slice(0, 700),
    source: row.source,
  }))
}
```

**向量转 Blob**：
```typescript
const vectorToBlob = (embedding: number[]): Buffer => 
  Buffer.from(new Float32Array(embedding).buffer)
```

### 3.3 全文搜索实现

```typescript
function searchKeyword(params: {
  db: DatabaseSync,
  query: string,
  limit: number,
  ftsTable: string,
}): SearchResult[] {
  const ftsQuery = buildFtsQuery(params.query)
  if (!ftsQuery) {
    return []
  }
  
  const rows = params.db.prepare(`
    SELECT id, path, start_line, end_line, text, source,
           bm25(${params.ftsTable}) AS rank
      FROM ${params.ftsTable}
     WHERE ${params.ftsTable} MATCH ?
     ORDER BY rank ASC
     LIMIT ?
  `).all(ftsQuery, params.limit)
  
  return rows.map(row => ({
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    score: bm25RankToScore(row.rank),  // BM25 → 0-1 score
    snippet: row.text.slice(0, 700),
    source: row.source,
  }))
}

// BM25 rank 转换为 0-1 分数
function bm25RankToScore(rank: number): number {
  const normalized = Math.max(0, rank)
  return 1 / (1 + normalized)
}
```

### 3.4 混合结果合并

**实现位置**：`src/memory/hybrid.ts`

```typescript
function mergeHybridResults(params: {
  vector: VectorResult[],
  keyword: KeywordResult[],
  vectorWeight: number,    // 默认 0.7
  textWeight: number,      // 默认 0.3
}): MergedResult[] {
  const byId = new Map()
  
  // Phase 1: 收集向量结果
  for (const r of params.vector) {
    byId.set(r.id, {
      ...r,
      vectorScore: r.score,
      textScore: 0,
    })
  }
  
  // Phase 2: 合并关键词结果
  for (const r of params.keyword) {
    const existing = byId.get(r.id)
    if (existing) {
      existing.textScore = r.score
      // 如果关键词结果有更好的 snippet，使用它
      if (r.snippet && r.snippet.length > 0) {
        existing.snippet = r.snippet
      }
    } else {
      byId.set(r.id, {
        ...r,
        vectorScore: 0,
        textScore: r.score,
      })
    }
  }
  
  // Phase 3: 加权合并分数
  const merged = Array.from(byId.values()).map(entry => ({
    ...entry,
    score: params.vectorWeight * entry.vectorScore + 
           params.textWeight * entry.textScore,
  }))
  
  // Phase 4: 按最终分数排序
  return merged.toSorted((a, b) => b.score - a.score)
}
```

**默认权重配置**：
```typescript
const HYBRID_WEIGHTS = {
  vectorWeight: 0.7,  // 语义相似度权重更高
  textWeight: 0.3,    // 关键词匹配作为补充
}
```

---

## 4. Session Store — JSON/JSON5 文件存储

### 4.1 目录结构

```
~/.openclaw/
├── sessions/
│   ├── registry.json5              # Session 元数据注册表
│   ├── chats/
│   │   ├── {sessionId}.json5       # 会话历史
│   │   └── ...
│   └── groups/
│       ├── {groupId}.json5         # 群组会话
│       └── ...
└── memory.db                       # Memory Index
```

### 4.2 Session Entry 数据模型

**实现位置**：`src/config/sessions/types.ts` (150+ lines)

```typescript
interface SessionEntry {
  // Identity
  sessionId: string            // UUID v4
  sessionFile?: string         // Relative path: "chats/{uuid}.json5"
  updatedAt: number           // Unix timestamp (ms)
  
  // Routing
  channel?: string            // "whatsapp" | "telegram" | "webchat"
  origin?: SessionOrigin      // Sender information
  deliveryContext?: DeliveryContext  // Destination information
  
  // Configuration Overrides
  modelOverride?: string      // e.g., "claude-sonnet-3-5"
  providerOverride?: string   // e.g., "anthropic"
  thinkingLevel?: string      // "off" | "low" | "medium" | "high"
  authProfileOverride?: string
  
  // State Tracking
  inputTokens?: number
  outputTokens?: number
  compactionCount?: number
  memoryFlushAt?: number     // Timestamp of last memory flush
  
  // Skills Snapshot
  skillsSnapshot?: SessionSkillSnapshot
  
  // System Prompt Report
  systemPromptReport?: SessionSystemPromptReport
  
  // Group Chat Settings
  groupActivation?: "mention" | "always"
  groupId?: string
  
  // Execution Security
  execHost?: string          // "workspace" | "docker" | "node"
  execSecurity?: string      // "allow" | "ask" | "deny"
  execNode?: string          // Node ID for remote execution
  
  // Response Formatting
  responseUsage?: "on" | "off" | "tokens" | "full"
  ttsAuto?: "on" | "off" | "dm-only"
  
  // Message Queueing
  queueMode?: "steer" | "followup" | "collect" | "interrupt"
  queueDebounceMs?: number
  queueCap?: number
  queueDrop?: "old" | "new" | "summarize"
}
```

**Session Skill Snapshot**：
```typescript
interface SessionSkillSnapshot {
  prompt: string                      // Injected skill descriptions
  skills: Array<{
    name: string
    primaryEnv?: string
  }>
  resolvedSkills?: Skill[]           // Full skill objects
  version?: number                   // Snapshot version
}
```

**System Prompt Report**（调试用）：
```typescript
interface SessionSystemPromptReport {
  source: "run" | "estimate"
  generatedAt: number
  provider?: string
  model?: string
  workspaceDir?: string
  systemPrompt: {
    chars: number
    projectContextChars: number      // Injected workspace files
    nonProjectContextChars: number   // Skill prompts, etc.
  }
  injectedWorkspaceFiles: Array<{
    name: string
    path: string
    missing: boolean
    rawChars: number
    injectedChars: number
    truncated: boolean
  }>
}
```

### 4.3 Session History 文件格式

**文件路径**：`~/.openclaw/sessions/chats/{sessionId}.json5`

```json5
{
  // Metadata
  sessionId: "550e8400-e29b-41d4-a716-446655440000",
  version: 2,
  createdAt: 1704067200000,
  updatedAt: 1704070800000,
  
  // Message History
  messages: [
    {
      role: "user",
      content: "How do I implement JWT authentication?",
      timestamp: 1704067200000,
    },
    {
      role: "assistant",
      content: "JWT authentication requires...",
      timestamp: 1704067205000,
      usage: {
        inputTokens: 120,
        outputTokens: 350,
      },
      thinkingBlocks: [
        {
          type: "thought",
          content: "First, I should explain the basic JWT flow...",
        },
      ],
      toolCalls: [
        {
          id: "call_abc123",
          name: "read",
          arguments: { path: "src/auth/jwt.ts" },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: "call_abc123",
      name: "read",
      content: "// JWT utility functions\n...",
    },
    // ...
  ],
  
  // Compaction Summaries (if compacted)
  compactedHistory: [
    {
      role: "system",
      content: "[Summary] Previous conversation covered JWT basics, middleware setup...",
      compactedAt: 1704069000000,
      originalMessageCount: 24,
    },
  ],
}
```

### 4.4 Locking Mechanism — 并发写入保护

**实现位置**：`src/config/sessions/store.ts`

OpenClaw 使用 `proper-lockfile` 防止多进程/线程同时修改 Session 文件：

```typescript
import Lockfile from 'proper-lockfile'

async function updateSessionFile(
  sessionId: string,
  updater: (data: SessionData) => SessionData,
): Promise<void> {
  const filePath = resolveSessionFilePath(sessionId)
  
  // 获取文件锁（最多等待 10 秒）
  const release = await Lockfile.lock(filePath, {
    retries: { retries: 10, minTimeout: 100, maxTimeout: 1000 },
  })
  
  try {
    // 读取当前内容
    const content = await fs.readFile(filePath, 'utf-8')
    const data = JSON5.parse(content)
    
    // 应用更新
    const updated = updater(data)
    updated.updatedAt = Date.now()
    
    // 写回文件（JSON5 格式，4 空格缩进）
    await fs.writeFile(
      filePath,
      JSON5.stringify(updated, null, 2),
      'utf-8'
    )
  } finally {
    // 释放锁
    await release()
  }
}
```

---

## 5. Memory Index Manager — 索引生命周期管理

### 5.1 索引构建流程

**实现位置**：`src/memory/manager.ts` (2398 lines, 核心组件)

```typescript
class MemoryIndexManager {
  async syncMemoryIndex(): Promise<void> {
    // Phase 1: 收集需要索引的文件
    const memoryFiles = await listMemoryFiles(this.workspaceDir)
    const sessionFiles = await listSessionFiles(this.transcriptsDir)
    
    // Phase 2: 检测文件变化
    const changedFiles = []
    for (const file of [...memoryFiles, ...sessionFiles]) {
      if (await this.shouldReindex(file)) {
        changedFiles.push(file)
      }
    }
    
    if (changedFiles.length === 0) {
      return  // 无变化，跳过
    }
    
    // Phase 3: 分块（Chunking）
    const chunks = []
    for (const file of changedFiles) {
      const fileChunks = await this.chunkFile(file)
      chunks.push(...fileChunks)
    }
    
    // Phase 4: 批量生成 Embeddings（并发）
    const embeddings = await this.generateEmbeddingsBatch(chunks)
    
    // Phase 5: 更新数据库
    this.db.exec("BEGIN TRANSACTION")
    try {
      for (let i = 0; i < chunks.length; i++) {
        this.upsertChunk(chunks[i], embeddings[i])
      }
      this.db.exec("COMMIT")
    } catch (err) {
      this.db.exec("ROLLBACK")
      throw err
    }
    
    // Phase 6: 更新 FTS 索引
    if (this.fts.available) {
      this.syncFtsIndex(chunks)
    }
    
    // Phase 7: 更新向量索引
    if (this.vector.available) {
      await this.syncVectorIndex(chunks, embeddings)
    }
  }
}
```

### 5.2 增量索引优化

**核心策略**：只重新索引已修改的文件

```typescript
private async shouldReindex(file: FileEntry): Promise<boolean> {
  const existing = this.db.prepare(
    "SELECT hash, mtime FROM files WHERE path = ?"
  ).get(file.path)
  
  if (!existing) {
    return true  // 新文件
  }
  
  // 比较 hash 和 mtime
  if (existing.hash !== file.hash || existing.mtime !== file.mtime) {
    // 删除旧 chunks
    this.db.prepare("DELETE FROM chunks WHERE path = ?").run(file.path)
    this.db.prepare("DELETE FROM chunks_fts WHERE path = ?").run(file.path)
    return true
  }
  
  return false  // 文件未变化
}
```

### 5.3 Batch Embedding 优化

**问题**：每次调用 Embedding API 有固定延迟（~200ms），逐个调用效率低。

**解决方案**：使用 OpenAI/Gemini Batch API

```typescript
async function generateEmbeddingsBatch(
  chunks: Chunk[],
  provider: "openai" | "gemini",
  model: string,
): Promise<number[][]> {
  const batchSize = 100  // OpenAI 支持单次 100 个
  const batches = []
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize))
  }
  
  // 并发发送批次请求
  const results = await Promise.all(
    batches.map(batch => 
      callBatchEmbeddingAPI(batch.map(c => c.text), provider, model)
    )
  )
  
  return results.flat()
}
```

**OpenAI Batch API**（`src/memory/batch-openai.ts`）：
```typescript
async function callBatchEmbeddingAPI(
  texts: string[],
  model: string,
  apiKey: string,
): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,  // 数组输入
    }),
  })
  
  const data = await response.json()
  
  // 返回结果已按输入顺序排列
  return data.data.map((item: any) => item.embedding)
}
```

### 5.4 File Watcher — 自动重新索引

**实现位置**：`src/memory/manager.ts` (使用 `chokidar`)

```typescript
class MemoryIndexManager {
  startWatcher(): void {
    this.watcher = chokidar.watch(this.workspaceDir, {
      ignored: /(^|[\/\\])\../,  // 忽略 dot 文件
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    })
    
    this.watcher.on('change', (path) => {
      this.dirty = true  // 标记需要重新索引
    })
    
    this.watcher.on('add', (path) => {
      this.dirty = true
    })
    
    // 定时检查并执行索引（防抖）
    this.intervalTimer = setInterval(() => {
      if (this.dirty) {
        this.dirty = false
        this.syncMemoryIndex().catch(err => {
          log.error("Memory index sync failed", err)
        })
      }
    }, 5000)  // 5 秒检查一次
  }
}
```

---

## 6. Session Delta Indexing — 会话增量索引

### 6.1 问题背景

Session 文件（transcript）在对话过程中频繁追加，完整重新索引成本高。

### 6.2 Delta 检测机制

```typescript
class MemoryIndexManager {
  private sessionDeltas = new Map<string, {
    lastSize: number,
    pendingBytes: number,
    pendingMessages: number,
  }>()
  
  async handleSessionUpdate(sessionId: string): Promise<void> {
    const filePath = resolveSessionFilePath(sessionId)
    const stats = await fs.stat(filePath)
    
    const delta = this.sessionDeltas.get(sessionId) || {
      lastSize: 0,
      pendingBytes: 0,
      pendingMessages: 0,
    }
    
    const newBytes = stats.size - delta.lastSize
    delta.pendingBytes += newBytes
    delta.pendingMessages += 1
    
    // 阈值触发：累计 64KB 或 10 条消息
    if (delta.pendingBytes >= 64 * 1024 || delta.pendingMessages >= 10) {
      await this.indexSessionDelta(sessionId, delta.lastSize, stats.size)
      delta.lastSize = stats.size
      delta.pendingBytes = 0
      delta.pendingMessages = 0
    }
    
    this.sessionDeltas.set(sessionId, delta)
  }
  
  async indexSessionDelta(
    sessionId: string,
    fromByte: number,
    toByte: number,
  ): Promise<void> {
    const filePath = resolveSessionFilePath(sessionId)
    
    // 只读取新增部分
    const fd = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(toByte - fromByte)
    await fd.read(buffer, 0, buffer.length, fromByte)
    await fd.close()
    
    // 解析新增消息
    const deltaContent = buffer.toString('utf-8')
    const newMessages = this.parseMessagesFromDelta(deltaContent)
    
    // 生成 chunks 和 embeddings
    const chunks = this.chunkMessages(newMessages)
    const embeddings = await this.generateEmbeddingsBatch(chunks)
    
    // 插入数据库
    this.upsertChunks(chunks, embeddings)
  }
}
```

**优化效果**：
- **减少文件 I/O**：只读取新增的字节范围
- **降低 API 成本**：只为新消息生成 embedding
- **提升响应速度**：索引延迟从秒级降至毫秒级

---

## 7. 工程实践与性能优化

### 7.1 索引性能参数

| 参数 | 默认值 | 说明 |
|:---|:---|:---|
| `SNIPPET_MAX_CHARS` | 700 | 搜索结果 snippet 最大字符数 |
| `EMBEDDING_BATCH_MAX_TOKENS` | 8000 | 单批次最大 token 数 |
| `EMBEDDING_INDEX_CONCURRENCY` | 4 | 并发索引任务数 |
| `EMBEDDING_RETRY_MAX_ATTEMPTS` | 3 | API 调用失败重试次数 |
| `SESSION_DIRTY_DEBOUNCE_MS` | 5000 | Session 更新防抖延迟 |
| `SESSION_DELTA_READ_CHUNK_BYTES` | 64KB | Delta 索引触发阈值 |
| `VECTOR_LOAD_TIMEOUT_MS` | 30s | 向量扩展加载超时 |
| `EMBEDDING_QUERY_TIMEOUT_REMOTE_MS` | 60s | 远程 Embedding API 超时 |
| `EMBEDDING_BATCH_TIMEOUT_REMOTE_MS` | 120s | 远程批量 Embedding 超时 |

### 7.2 数据库优化配置

```typescript
// WAL 模式（Write-Ahead Logging）
db.exec("PRAGMA journal_mode = WAL")

// 同步模式（平衡性能和安全性）
db.exec("PRAGMA synchronous = NORMAL")

// 缓存大小（128MB）
db.exec("PRAGMA cache_size = -128000")

// 自动清理
db.exec("PRAGMA auto_vacuum = INCREMENTAL")
```

### 7.3 缓存策略

**Embedding Cache 管理**：
```typescript
// 定期清理过期缓存（保留最近 30 天）
async function pruneEmbeddingCache(db: DatabaseSync): Promise<void> {
  const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000
  
  const deleted = db.prepare(`
    DELETE FROM embedding_cache 
    WHERE updated_at < ?
  `).run(cutoffTime)
  
  log.info(`Pruned ${deleted.changes} old cache entries`)
}
```

**Memory Index Cache**：
```typescript
const INDEX_CACHE = new Map<string, MemoryIndexManager>()

// 缓存 Key: agentId + workspaceDir + settings
const cacheKey = `${agentId}:${workspaceDir}:${JSON.stringify(settings)}`
```

### 7.4 错误恢复机制

**Embedding API 失败重试**：
```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err
      }
      
      // 指数退避
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      await sleep(Math.min(delay, 8000))
    }
  }
  
  throw new Error("Unreachable")
}
```

**Batch 失败限制**：
```typescript
// 连续失败 2 次后，禁用 Batch API，降级到逐个调用
if (this.batchFailureCount >= 2) {
  log.warn("Batch API failed repeatedly, falling back to individual calls")
  this.batch.enabled = false
}
```

---

## 8. 关键文件索引

| 功能模块 | 核心文件 | 代码量 | 关键职责 |
|:---|:---|:---|:---|
| **Memory Manager** | `src/memory/manager.ts` | 2398 行 | 索引生命周期、Watcher、Delta 检测 |
| **Schema** | `src/memory/memory-schema.ts` | 97 行 | SQLite 表定义、Migration |
| **Vector Search** | `src/memory/manager-search.ts` | - | `sqlite-vec` 查询、Fallback |
| **Hybrid Merge** | `src/memory/hybrid.ts` | 115 行 | 向量 + FTS 结果合并 |
| **Embeddings** | `src/memory/embeddings.ts` | 238 行 | Provider 抽象、Failover |
| **Batch OpenAI** | `src/memory/batch-openai.ts` | - | 批量 Embedding 调用 |
| **Batch Gemini** | `src/memory/batch-gemini.ts` | - | Gemini Batch API |
| **SQLite-vec** | `src/memory/sqlite-vec.ts` | 25 行 | 扩展加载、错误处理 |
| **Session Types** | `src/config/sessions/types.ts` | 150+ 行 | Session 数据模型 |
| **Session Store** | `src/config/sessions/store.ts` | - | 文件锁、读写操作 |

---

## 9. 设计模式总结

### 9.1 关注点分离

- **Schema 定义**：`memory-schema.ts` 独立于业务逻辑
- **Provider 抽象**：`embeddings.ts` 统一 OpenAI/Gemini/Local 接口
- **Search 策略**：向量和全文搜索独立实现，由 `hybrid.ts` 组合

### 9.2 降级与容错

- **sqlite-vec 不可用** → JavaScript cosine similarity
- **Batch API 失败** → 逐个调用 Embedding API
- **FTS5 加载失败** → 仅使用向量搜索

### 9.3 性能优化原则

- **批量操作**：Batch Embedding API，减少网络往返
- **增量更新**：文件 hash 比对，Delta 索引
- **并发控制**：Embedding 生成并发数限制（避免 Rate Limit）
- **缓存优先**：Embedding Cache 永久保存

---

**文档版本**：基于 OpenClaw commit `75093ebe1` (2026-01-30)  
**适用场景**：PonyBunny 项目的数据库架构参考指南
