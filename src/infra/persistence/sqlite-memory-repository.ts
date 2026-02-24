import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  ICoreMemoryResult,
  IMemoryRepository,
  IKeywordSearchResult,
  IVectorSearchResult,
} from '../../app/conversation/memory-service.js';

interface MemoryEntryRow {
  entry_id: string;
  session_id: string;
  turn_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  vector_score: number;
}

interface KeywordEntryRow {
  entry_id: string;
  session_id: string;
  turn_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  keyword_score: number;
}

interface CacheRow {
  embedding: Buffer;
}

interface CoreMemoryRow {
  memory_id: string;
  session_id: string;
  owner_type: 'agent' | 'user';
  owner_id: string;
  turn_id: string | null;
  role: 'user' | 'assistant';
  raw_content: string;
  summary: string;
  importance: number;
  created_at: number;
  rank_score?: number;
}

const COSINE_FUNCTION = 'cosine_similarity';

export class SqliteMemoryRepository implements IMemoryRepository {
  constructor(private db: Database.Database) {
    this.db.function(COSINE_FUNCTION, (left: Buffer, right: Buffer) => {
      return cosineFromBuffers(left, right);
    });
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        turn_id TEXT UNIQUE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        embedding_dim INTEGER NOT NULL,
        embedding_model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_entries_session_created
      ON memory_entries(session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memory_entries_model_dim
      ON memory_entries(embedding_model, embedding_dim);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
        content,
        entry_id UNINDEXED,
        session_id UNINDEXED,
        role UNINDEXED,
        content='memory_entries',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memory_entries_ai AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(rowid, content, entry_id, session_id, role)
        VALUES (new.rowid, new.content, new.entry_id, new.session_id, new.role);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_entries_ad AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content, entry_id, session_id, role)
        VALUES ('delete', old.rowid, old.content, old.entry_id, old.session_id, old.role);
      END;

      CREATE TRIGGER IF NOT EXISTS memory_entries_au AFTER UPDATE ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content, entry_id, session_id, role)
        VALUES ('delete', old.rowid, old.content, old.entry_id, old.session_id, old.role);
        INSERT INTO memory_entries_fts(rowid, content, entry_id, session_id, role)
        VALUES (new.rowid, new.content, new.entry_id, new.session_id, new.role);
      END;

      CREATE TABLE IF NOT EXISTS embedding_cache (
        cache_key TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding_dim INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (cache_key, embedding_model)
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_lru
      ON embedding_cache(last_accessed_at ASC);

      CREATE TABLE IF NOT EXISTS core_memories (
        memory_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        owner_type TEXT NOT NULL DEFAULT 'agent',
        owner_id TEXT NOT NULL DEFAULT 'legacy-default-agent',
        turn_id TEXT UNIQUE,
        role TEXT NOT NULL,
        raw_content TEXT NOT NULL,
        summary TEXT NOT NULL,
        importance REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (memory_id)
      );

      CREATE INDEX IF NOT EXISTS idx_core_memories_session_created
      ON core_memories(session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_core_memories_owner
      ON core_memories(session_id, owner_type, owner_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_core_memories_importance
      ON core_memories(session_id, importance DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS core_memories_fts USING fts5(
        summary,
        raw_content,
        memory_id UNINDEXED,
        session_id UNINDEXED,
        content='core_memories',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS core_memories_ai AFTER INSERT ON core_memories BEGIN
        INSERT INTO core_memories_fts(rowid, summary, raw_content, memory_id, session_id)
        VALUES (new.rowid, new.summary, new.raw_content, new.memory_id, new.session_id);
      END;

      CREATE TRIGGER IF NOT EXISTS core_memories_ad AFTER DELETE ON core_memories BEGIN
        INSERT INTO core_memories_fts(core_memories_fts, rowid, summary, raw_content, memory_id, session_id)
        VALUES ('delete', old.rowid, old.summary, old.raw_content, old.memory_id, old.session_id);
      END;

      CREATE TRIGGER IF NOT EXISTS core_memories_au AFTER UPDATE ON core_memories BEGIN
        INSERT INTO core_memories_fts(core_memories_fts, rowid, summary, raw_content, memory_id, session_id)
        VALUES ('delete', old.rowid, old.summary, old.raw_content, old.memory_id, old.session_id);
        INSERT INTO core_memories_fts(rowid, summary, raw_content, memory_id, session_id)
        VALUES (new.rowid, new.summary, new.raw_content, new.memory_id, new.session_id);
      END;
    `);

    this.ensureCoreMemoryScopeColumns();
  }

  private ensureCoreMemoryScopeColumns(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(core_memories)')
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((item) => item.name));

    if (!names.has('owner_type')) {
      this.db.exec("ALTER TABLE core_memories ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'agent'");
    }
    if (!names.has('owner_id')) {
      this.db.exec(
        "ALTER TABLE core_memories ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-default-agent'"
      );
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_core_memories_owner
      ON core_memories(session_id, owner_type, owner_id, created_at DESC);
    `);
  }

  indexEntry(input: {
    sessionId: string;
    turnId?: string;
    role: 'user' | 'assistant';
    content: string;
    embedding: Float32Array;
    embeddingModel: string;
    createdAt: number;
  }): void {
    const now = Date.now();
    const entryId = input.turnId ? `${input.sessionId}:${input.turnId}` : randomUUID();
    const embeddingBuffer = float32ToBuffer(input.embedding);

    const stmt = this.db.prepare(`
      INSERT INTO memory_entries (
        entry_id, session_id, turn_id, role, content, embedding, embedding_dim, embedding_model, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        role = excluded.role,
        content = excluded.content,
        embedding = excluded.embedding,
        embedding_dim = excluded.embedding_dim,
        embedding_model = excluded.embedding_model,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      entryId,
      input.sessionId,
      input.turnId ?? null,
      input.role,
      input.content,
      embeddingBuffer,
      input.embedding.length,
      input.embeddingModel,
      input.createdAt,
      now
    );
  }

  upsertCoreMemory(input: {
    sessionId: string;
    ownerType: 'agent' | 'user';
    ownerId: string;
    turnId?: string;
    role: 'user' | 'assistant';
    rawContent: string;
    summary: string;
    importance: number;
    createdAt: number;
  }): void {
    const now = Date.now();
    const memoryId = input.turnId ? `${input.sessionId}:${input.turnId}` : randomUUID();

    const stmt = this.db.prepare(`
      INSERT INTO core_memories (
        memory_id, session_id, owner_type, owner_id, turn_id, role, raw_content, summary, importance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        owner_type = excluded.owner_type,
        owner_id = excluded.owner_id,
        role = excluded.role,
        raw_content = excluded.raw_content,
        summary = excluded.summary,
        importance = excluded.importance,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      memoryId,
      input.sessionId,
      input.ownerType,
      input.ownerId,
      input.turnId ?? null,
      input.role,
      input.rawContent,
      input.summary,
      input.importance,
      input.createdAt,
      now
    );
  }

  searchCoreMemories(
    sessionId: string,
    ownerScope: { ownerType: 'agent' | 'user'; ownerId: string },
    query: string,
    limit: number
  ): ICoreMemoryResult[] {
    if (limit <= 0) {
      return [];
    }

    const normalized = normalizeFtsQuery(query);
    if (normalized.length === 0) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT
        cm.memory_id,
        cm.session_id,
        cm.owner_type,
        cm.owner_id,
        cm.turn_id,
        cm.role,
        cm.raw_content,
        cm.summary,
        cm.importance,
        cm.created_at,
        bm25(core_memories_fts) AS rank_score
      FROM core_memories_fts
      JOIN core_memories cm ON cm.rowid = core_memories_fts.rowid
      WHERE core_memories_fts MATCH ?
        AND cm.session_id = ?
        AND cm.owner_type = ?
        AND cm.owner_id = ?
      ORDER BY rank_score ASC, cm.importance DESC, cm.created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(
      normalized,
      sessionId,
      ownerScope.ownerType,
      ownerScope.ownerId,
      limit
    ) as CoreMemoryRow[];
    return rows.map((row) => ({
      memoryId: row.memory_id,
      sessionId: row.session_id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      turnId: row.turn_id ?? undefined,
      role: row.role,
      rawContent: row.raw_content,
      summary: row.summary,
      importance: row.importance,
      createdAt: row.created_at,
      score: row.rank_score !== undefined ? 1 / (1 + Math.exp(row.rank_score)) : undefined,
    }));
  }

  listCoreMemories(
    sessionId: string,
    ownerScope: { ownerType: 'agent' | 'user'; ownerId: string },
    limit: number
  ): ICoreMemoryResult[] {
    if (limit <= 0) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT
        memory_id,
        session_id,
        owner_type,
        owner_id,
        turn_id,
        role,
        raw_content,
        summary,
        importance,
        created_at
      FROM core_memories
      WHERE session_id = ?
        AND owner_type = ?
        AND owner_id = ?
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(sessionId, ownerScope.ownerType, ownerScope.ownerId, limit) as CoreMemoryRow[];
    return rows.map((row) => ({
      memoryId: row.memory_id,
      sessionId: row.session_id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      turnId: row.turn_id ?? undefined,
      role: row.role,
      rawContent: row.raw_content,
      summary: row.summary,
      importance: row.importance,
      createdAt: row.created_at,
    }));
  }

  searchVector(sessionId: string, queryEmbedding: Float32Array, limit: number): IVectorSearchResult[] {
    if (limit <= 0) {
      return [];
    }

    const candidateLimit = Math.max(limit * 8, 64);
    const embedding = float32ToBuffer(queryEmbedding);

    const stmt = this.db.prepare(`
      WITH recent_candidates AS (
        SELECT
          entry_id,
          session_id,
          turn_id,
          role,
          content,
          created_at,
          embedding,
          ${COSINE_FUNCTION}(embedding, ?) AS vector_score
        FROM memory_entries
        WHERE session_id = ?
          AND embedding_dim = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
      SELECT
        entry_id,
        session_id,
        turn_id,
        role,
        content,
        created_at,
        vector_score
      FROM recent_candidates
      ORDER BY vector_score DESC, created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(
      embedding,
      sessionId,
      queryEmbedding.length,
      candidateLimit,
      limit
    ) as MemoryEntryRow[];

    return rows.map((row) => ({
      entryId: row.entry_id,
      sessionId: row.session_id,
      turnId: row.turn_id ?? undefined,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      score: row.vector_score,
    }));
  }

  searchKeyword(sessionId: string, query: string, limit: number): IKeywordSearchResult[] {
    if (limit <= 0) {
      return [];
    }

    const normalizedQuery = normalizeFtsQuery(query);
    if (normalizedQuery.length === 0) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT
        me.entry_id,
        me.session_id,
        me.turn_id,
        me.role,
        me.content,
        me.created_at,
        bm25(memory_entries_fts) AS keyword_score
      FROM memory_entries_fts
      JOIN memory_entries me ON me.rowid = memory_entries_fts.rowid
      WHERE memory_entries_fts MATCH ?
        AND me.session_id = ?
      ORDER BY keyword_score ASC, me.created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(normalizedQuery, sessionId, limit) as KeywordEntryRow[];

    return rows.map((row) => ({
      entryId: row.entry_id,
      sessionId: row.session_id,
      turnId: row.turn_id ?? undefined,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      score: row.keyword_score,
    }));
  }

  getCachedEmbedding(cacheKey: string, model: string): Float32Array | null {
    const stmt = this.db.prepare(`
      SELECT embedding
      FROM embedding_cache
      WHERE cache_key = ? AND embedding_model = ?
      LIMIT 1
    `);

    const row = stmt.get(cacheKey, model) as CacheRow | undefined;
    if (!row) {
      return null;
    }

    return bufferToFloat32(row.embedding);
  }

  touchCachedEmbedding(cacheKey: string, model: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE embedding_cache
      SET last_accessed_at = ?, access_count = access_count + 1
      WHERE cache_key = ? AND embedding_model = ?
    `);
    stmt.run(now, cacheKey, model);
  }

  upsertCachedEmbedding(cacheKey: string, model: string, embedding: Float32Array): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO embedding_cache (
        cache_key,
        embedding_model,
        embedding_dim,
        embedding,
        created_at,
        last_accessed_at,
        access_count
      ) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(cache_key, embedding_model) DO UPDATE SET
        embedding_dim = excluded.embedding_dim,
        embedding = excluded.embedding,
        last_accessed_at = excluded.last_accessed_at,
        access_count = embedding_cache.access_count + 1
    `);
    stmt.run(cacheKey, model, embedding.length, float32ToBuffer(embedding), now, now);
  }

  pruneEmbeddingCache(maxEntries: number): number {
    if (maxEntries <= 0) {
      return 0;
    }

    const countStmt = this.db.prepare('SELECT COUNT(*) AS count FROM embedding_cache');
    const countRow = countStmt.get() as { count: number };
    const overflow = countRow.count - maxEntries;
    if (overflow <= 0) {
      return 0;
    }

    const stmt = this.db.prepare(`
      DELETE FROM embedding_cache
      WHERE (cache_key, embedding_model) IN (
        SELECT cache_key, embedding_model
        FROM embedding_cache
        ORDER BY last_accessed_at ASC
        LIMIT ?
      )
    `);

    const result = stmt.run(overflow);
    return result.changes;
  }
}

function float32ToBuffer(value: Float32Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function bufferToFloat32(value: Buffer): Float32Array {
  const view = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new Float32Array(view);
}

function cosineFromBuffers(left: Buffer, right: Buffer): number {
  const leftVec = bufferToFloat32(left);
  const rightVec = bufferToFloat32(right);

  if (leftVec.length === 0 || rightVec.length === 0 || leftVec.length !== rightVec.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < leftVec.length; index += 1) {
    const leftValue = leftVec[index] ?? 0;
    const rightValue = rightVec[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function normalizeFtsQuery(value: string): string {
  const terms = value
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .map((item) => item.replace(/[^a-z0-9_\-]/g, ''))
    .filter((item) => item.length >= 2);

  if (terms.length === 0) {
    return '';
  }

  return terms.map((term) => `${term}*`).join(' OR ');
}
