# Database & Data Model

OpenClaw uses a "Dual Store" architecture:
1.  **JSON/JSON5 Files**: For high-level Session state and Chat History. Optimized for human-readability and portability.
2.  **SQLite**: For high-performance Vector Search (Memory), Full-Text Search, and Caching.

## 1. SQLite Schema (`memory.db`)

Located at `~/.openclaw/memory.db` (default). Managed via `src/memory/memory-schema.ts`.

### Tables

| Table Name | Description | Key Columns |
| :--- | :--- | :--- |
| **`meta`** | Key-value store for database configuration and migration state. | `key` (PK), `value` |
| **`files`** | Tracks source files indexed into memory. | `path` (PK), `hash`, `mtime`, `size` |
| **`chunks`** | Stores text chunks and their vector embeddings. | `id` (PK), `text`, `embedding`, `path` (FK) |
| **`embedding_cache`** | Caches LLM embeddings to save costs/latency. | `hash` (PK), `provider`, `model`, `embedding` |
| **`fts`** | Virtual table (FTS5) for keyword search on chunks. | `text`, `metadata` (unindexed) |

### Vector Search
- Uses `sqlite-vec` extension.
- Embeddings are stored as JSON strings or Blobs in the `embedding` column.
- Querying involves vector distance functions (e.g., cosine similarity).

## 2. Session Data Model

Sessions are stored as individual JSON/JSON5 files in `~/.openclaw/sessions/`.

### Session Object (`SessionEntry`)
Defined in `src/config/sessions/types.ts`.

```typescript
interface SessionEntry {
  // Identity
  sessionId: string;       // UUID v4
  version: number;         // Schema version
  
  // Storage
  sessionFile: string;     // Relative path to history file (e.g., "chats/uuid.json")
  updatedAt: number;       // Unix timestamp (ms)
  
  // Routing
  channel: string;         // e.g., "whatsapp", "telegram"
  origin: {
    senderId: string;
    senderName?: string;
    // ...
  };
  deliveryContext: {
    to: string;            // Destination ID (e.g., phone number)
    threadId?: string;
    // ...
  };
  
  // Configuration
  model: string;           // e.g., "claude-3-opus"
  thinkingLevel: number;   // 0-5
  systemPrompt?: string;   // Override system prompt
  
  // State
  stats: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

### Session History
The actual conversation is stored in a separate file referenced by `sessionFile`. This keeps the main session registry lightweight.
