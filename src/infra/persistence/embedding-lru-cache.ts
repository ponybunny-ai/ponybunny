/**
 * In-memory LRU cache layer for embeddings.
 *
 * Sits in front of the SQLite embedding_cache table so that reads
 * hit memory first (no write-on-read to SQLite).  SQLite is only
 * touched on cold-start warming (miss -> promote) and on writes.
 *
 * Uses a plain Map whose insertion-order semantics give us O(1) LRU:
 *   - get() deletes + re-inserts to move the key to the end (MRU)
 *   - set() appends at the end and evicts the oldest (first) entry
 *     when the map exceeds maxEntries
 *
 * ADR-002 Phase D1
 */

export interface EmbeddingSqliteDelegate {
  get(key: string, model: string): Float32Array | null;
  set(key: string, model: string, embedding: Float32Array): void;
}

export class EmbeddingLruCache {
  private readonly cache = new Map<string, Float32Array>();
  private readonly maxEntries: number;
  private readonly sqliteGet: EmbeddingSqliteDelegate['get'];
  private readonly sqliteSet: EmbeddingSqliteDelegate['set'];

  constructor(opts: {
    maxEntries?: number;
    sqliteGet: EmbeddingSqliteDelegate['get'];
    sqliteSet: EmbeddingSqliteDelegate['set'];
  }) {
    this.maxEntries = opts.maxEntries ?? 500;
    this.sqliteGet = opts.sqliteGet;
    this.sqliteSet = opts.sqliteSet;
  }

  /** Composite cache key combining content key and model identifier. */
  private cacheKey(key: string, model: string): string {
    return `${key}\0${model}`;
  }

  /**
   * Look up an embedding.
   *
   * 1. Check the in-memory LRU first (promote to MRU position).
   * 2. On miss, fall through to the SQLite delegate.
   * 3. If found in SQLite, promote into the memory cache.
   * 4. No write-on-read to SQLite — the whole point of this layer.
   */
  get(key: string, model: string): Float32Array | null {
    const ck = this.cacheKey(key, model);

    // Memory hit — move to MRU position
    const cached = this.cache.get(ck);
    if (cached !== undefined) {
      this.cache.delete(ck);
      this.cache.set(ck, cached);
      return cached;
    }

    // Memory miss — try SQLite
    const fromSqlite = this.sqliteGet(key, model);
    if (fromSqlite !== null) {
      this.promoteToMemory(ck, fromSqlite);
      return fromSqlite;
    }

    return null;
  }

  /**
   * Store an embedding.
   *
   * Writes to both the in-memory LRU and the SQLite delegate.
   * The SQLite write is fire-and-forget (errors logged, not thrown).
   */
  set(key: string, model: string, embedding: Float32Array): void {
    const ck = this.cacheKey(key, model);

    // Always update memory cache (move to MRU if already present)
    this.cache.delete(ck);
    this.cache.set(ck, embedding);
    this.evictIfNeeded();

    // Persist to SQLite — fire-and-forget
    try {
      this.sqliteSet(key, model, embedding);
    } catch (_err: unknown) {
      // Intentionally swallowed — SQLite is a persistence layer,
      // not critical path.  The in-memory value is still available.
    }
  }

  /** Current number of entries held in-memory. */
  get size(): number {
    return this.cache.size;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  private promoteToMemory(ck: string, embedding: Float32Array): void {
    this.cache.set(ck, embedding);
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries) {
      // Map iteration order is insertion order — first key is the LRU
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
  }
}
