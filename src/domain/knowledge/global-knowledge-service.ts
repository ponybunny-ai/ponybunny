/**
 * GlobalKnowledgeService
 *
 * Cross-goal knowledge persistence layer — the core of the failure learning flywheel.
 *
 * Responsibilities:
 * - Extract reusable knowledge from completed/failed goals (via ContextPack)
 * - Retrieve relevant knowledge for injection into new goal Elaboration
 * - Reinforce knowledge when the same pattern recurs
 * - Allow manual recording of new knowledge entries
 *
 * Boundary: This service owns the `global_knowledge` table.
 * It does NOT perform LLM calls — callers (e.g. `pb learn`) handle LLM extraction.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ContextPack } from '../../work-order/types/index.js';
import type { EmbeddingLruCache } from '../../infra/persistence/embedding-lru-cache.js';
import type { IEmbeddingService } from '../../app/conversation/memory-service.js';
import type { ILogger } from '../../infra/observability/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KnowledgeType =
  | 'pitfall'
  | 'pattern'
  | 'approach'
  | 'decision'
  | 'constraint'
  | 'failure_mode'
  | 'time_estimate'
  | 'tool_preference';

export interface GlobalKnowledge {
  id: string;
  created_at: number;
  source_goal_id: string | null;
  source_context_pack_id: string | null;
  knowledge_type: KnowledgeType;
  domain_tags: string[];
  scope: string | null;
  content: string;
  confidence: number;
  occurrence_count: number;
  last_reinforced_at: number;
  decayed_at: number | null;
}

export interface GlobalKnowledgeEntry {
  knowledge_type: KnowledgeType;
  content: string;
  domain_tags?: string[];
  scope?: string;
  source_goal_id?: string;
  source_context_pack_id?: string;
  confidence?: number;
}

interface GlobalKnowledgeRow {
  id: string;
  created_at: number;
  source_goal_id: string | null;
  source_context_pack_id: string | null;
  knowledge_type: string;
  domain_tags: string | null;
  scope: string | null;
  content: string;
  confidence: number;
  occurrence_count: number;
  last_reinforced_at: number;
  decayed_at: number | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GlobalKnowledgeService {
  private embeddingCache?: EmbeddingLruCache;
  private embeddingService?: IEmbeddingService;
  private embeddingModel?: string;
  private logger?: ILogger;

  constructor(
    private db: Database.Database,
    deps?: {
      embeddingCache?: EmbeddingLruCache;
      embeddingService?: IEmbeddingService;
      embeddingModel?: string;
      logger?: ILogger;
    },
  ) {
    this.embeddingCache = deps?.embeddingCache;
    this.embeddingService = deps?.embeddingService;
    this.embeddingModel = deps?.embeddingModel ?? deps?.embeddingService?.model;
    this.logger = deps?.logger;
  }

  /**
   * Extract knowledge entries from a ContextPack's knowledge_base field.
   * This is a direct extraction — no LLM involved. It maps the per-goal
   * pitfalls/patterns/approaches into global_knowledge rows.
   */
  extractFromContextPack(pack: ContextPack): GlobalKnowledge[] {
    const now = Date.now();
    const kb = pack.snapshot_data.knowledge_base;
    const extracted: GlobalKnowledge[] = [];

    for (const pitfall of kb.pitfalls_discovered) {
      const entry = this.recordOrReinforce({
        knowledge_type: 'pitfall',
        content: pitfall,
        source_goal_id: pack.goal_id,
        source_context_pack_id: pack.id,
      }, now);
      extracted.push(entry);
    }

    for (const pattern of kb.learned_patterns) {
      const entry = this.recordOrReinforce({
        knowledge_type: 'pattern',
        content: pattern,
        source_goal_id: pack.goal_id,
        source_context_pack_id: pack.id,
      }, now);
      extracted.push(entry);
    }

    for (const approach of kb.successful_approaches) {
      const entry = this.recordOrReinforce({
        knowledge_type: 'approach',
        content: approach,
        source_goal_id: pack.goal_id,
        source_context_pack_id: pack.id,
      }, now);
      extracted.push(entry);
    }

    return extracted;
  }

  /**
   * Get knowledge entries relevant to a goal context.
   * Returns highest-confidence entries, optionally filtered by type or tags.
   *
   * Query strategy:
   * - Ordering: confidence DESC → occurrence_count DESC → last_reinforced_at DESC
   * - Tag matching: client-side set intersection (SQLite JSON support varies);
   *   fetches limit entries first, then filters by tags, so effective results
   *   may be fewer than limit when tag filtering is active.
   * - Default minConfidence: 0.0 (no threshold). Call sites should set explicit
   *   thresholds based on injection context:
   *     Elaboration: limit=5, minConfidence=0.4 (high-signal pitfalls only)
   *     Planning: limit=3-5, minConfidence=0.3 (broader patterns acceptable)
   *   Higher minConfidence reduces prompt cost; lower values catch emerging patterns.
   * - Default limit: 10 entries max to bound prompt injection size.
   */
  getRelevantKnowledge(options?: {
    knowledgeType?: KnowledgeType | KnowledgeType[];
    domainTags?: string[];
    limit?: number;
    minConfidence?: number;
  }): GlobalKnowledge[] {
    const limit = options?.limit ?? 10;
    const minConfidence = options?.minConfidence ?? 0.0;

    let sql = `SELECT * FROM global_knowledge WHERE confidence >= ? AND decayed_at IS NULL`;
    const params: (string | number)[] = [minConfidence];

    if (options?.knowledgeType) {
      const types = Array.isArray(options.knowledgeType)
        ? options.knowledgeType
        : [options.knowledgeType];
      if (types.length === 1) {
        sql += ` AND knowledge_type = ?`;
        params.push(types[0]);
      } else if (types.length > 1) {
        sql += ` AND knowledge_type IN (${types.map(() => '?').join(', ')})`;
        params.push(...types);
      }
    }

    sql += ` ORDER BY confidence DESC, occurrence_count DESC, last_reinforced_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as GlobalKnowledgeRow[];

    let results = rows.map(rowToKnowledge);

    // Client-side tag filtering (SQLite JSON support varies)
    if (options?.domainTags && options.domainTags.length > 0) {
      const targetTags = new Set(options.domainTags.map(t => t.toLowerCase()));
      results = results.filter(k =>
        k.domain_tags.some(tag => targetTags.has(tag.toLowerCase()))
      );
    }

    return results;
  }

  /**
   * Reinforce an existing knowledge entry — bumps confidence and count.
   */
  reinforce(knowledgeId: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE global_knowledge
      SET occurrence_count = occurrence_count + 1,
          confidence = MIN(1.0, confidence + 0.1),
          last_reinforced_at = ?
      WHERE id = ?
    `).run(now, knowledgeId);
  }

  /**
   * Record a new knowledge entry, deduplicating on type + scope + content.
   * If a matching active entry exists, reinforces it instead of inserting.
   */
  record(entry: GlobalKnowledgeEntry): GlobalKnowledge {
    const scope = entry.scope ?? null;

    // Dedup: exact match on type + scope + content (active entries only)
    const existing = (scope === null
      ? this.db.prepare(
          'SELECT * FROM global_knowledge WHERE knowledge_type = ? AND scope IS NULL AND content = ? AND decayed_at IS NULL LIMIT 1'
        ).get(entry.knowledge_type, entry.content)
      : this.db.prepare(
          'SELECT * FROM global_knowledge WHERE knowledge_type = ? AND scope = ? AND content = ? AND decayed_at IS NULL LIMIT 1'
        ).get(entry.knowledge_type, scope, entry.content)
    ) as GlobalKnowledgeRow | undefined;

    if (existing) {
      this.reinforce(existing.id);
      return { ...rowToKnowledge(existing), occurrence_count: existing.occurrence_count + 1 };
    }

    const now = Date.now();
    const id = randomUUID();
    const row: GlobalKnowledgeRow = {
      id,
      created_at: now,
      source_goal_id: entry.source_goal_id ?? null,
      source_context_pack_id: entry.source_context_pack_id ?? null,
      knowledge_type: entry.knowledge_type,
      domain_tags: JSON.stringify(entry.domain_tags ?? []),
      scope,
      content: entry.content,
      confidence: entry.confidence ?? 0.5,
      occurrence_count: 1,
      last_reinforced_at: now,
      decayed_at: null,
    };

    this.db.prepare(`
      INSERT INTO global_knowledge
        (id, created_at, source_goal_id, source_context_pack_id,
         knowledge_type, domain_tags, scope, content, confidence,
         occurrence_count, last_reinforced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.created_at, row.source_goal_id, row.source_context_pack_id,
      row.knowledge_type, row.domain_tags, row.scope, row.content, row.confidence,
      row.occurrence_count, row.last_reinforced_at
    );

    // Fire-and-forget embedding generation — failures never block record()
    if (this.embeddingService && this.embeddingModel) {
      this.generateAndStoreEmbedding(row.id, entry.content).catch((err) => {
        this.logger?.warn({ event: 'knowledge_embedding_failed', knowledgeId: row.id }, `Knowledge embedding failed: ${err}`);
      });
    }

    return rowToKnowledge(row);
  }

  /**
   * Get a single entry by ID.
   */
  getById(id: string): GlobalKnowledge | null {
    const row = this.db.prepare('SELECT * FROM global_knowledge WHERE id = ?').get(id) as GlobalKnowledgeRow | undefined;
    return row ? rowToKnowledge(row) : null;
  }

  /**
   * List all entries, optionally filtered by type.
   */
  list(options?: { knowledgeType?: KnowledgeType; limit?: number }): GlobalKnowledge[] {
    const limit = options?.limit ?? 100;
    let sql = 'SELECT * FROM global_knowledge WHERE decayed_at IS NULL';
    const params: (string | number)[] = [];

    if (options?.knowledgeType) {
      sql += ' AND knowledge_type = ?';
      params.push(options.knowledgeType);
    }

    sql += ' ORDER BY confidence DESC, last_reinforced_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as GlobalKnowledgeRow[];
    return rows.map(rowToKnowledge);
  }

  /**
   * Get summary statistics.
   */
  getStats(): { total: number; byType: Record<KnowledgeType, number>; avgConfidence: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM global_knowledge WHERE decayed_at IS NULL').get() as { count: number }).count;
    const byTypeRows = this.db.prepare(
      'SELECT knowledge_type, COUNT(*) as count FROM global_knowledge WHERE decayed_at IS NULL GROUP BY knowledge_type'
    ).all() as { knowledge_type: string; count: number }[];

    const byType: Record<KnowledgeType, number> = {
      pitfall: 0, pattern: 0, approach: 0, decision: 0,
      constraint: 0, failure_mode: 0, time_estimate: 0, tool_preference: 0,
    };
    for (const row of byTypeRows) {
      byType[row.knowledge_type as KnowledgeType] = row.count;
    }

    const avgRow = this.db.prepare('SELECT AVG(confidence) as avg FROM global_knowledge WHERE decayed_at IS NULL').get() as { avg: number | null };

    return { total, byType, avgConfidence: avgRow.avg ?? 0 };
  }

  /**
   * Retrieve knowledge entries using semantic (embedding-based) similarity.
   *
   * Generates an embedding for `queryText`, loads all entries with embeddings
   * matching the given filters, computes cosine similarity, and returns the
   * top `limit` results ordered by similarity DESC.
   *
   * Falls back to tag-based `getRelevantKnowledge()` when:
   * - embeddingService is not configured
   * - no entries have embeddings
   */
  async getRelevantKnowledgeSemantic(
    queryText: string,
    types: KnowledgeType[],
    limit: number = 10,
    confidenceThreshold: number = 0.5,
  ): Promise<GlobalKnowledge[]> {
    // Fallback: no embedding infrastructure configured
    if (!this.embeddingService || !this.embeddingModel) {
      return this.getRelevantKnowledge({
        knowledgeType: types,
        limit,
        minConfidence: confidenceThreshold,
      });
    }

    // Generate query embedding (using cache if available)
    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await this.getOrCreateEmbedding(queryText);
    } catch {
      // If embedding generation fails, fall back to tag-based
      this.logger?.warn({ event: 'semantic_query_embedding_failed' }, 'Failed to generate query embedding, falling back to tag-based retrieval');
      return this.getRelevantKnowledge({
        knowledgeType: types,
        limit,
        minConfidence: confidenceThreshold,
      });
    }

    // Load candidate entries with embeddings
    const typePlaceholders = types.map(() => '?').join(', ');
    const sql = `
      SELECT * FROM global_knowledge
      WHERE embedding IS NOT NULL
        AND knowledge_type IN (${typePlaceholders})
        AND confidence >= ?
        AND decayed_at IS NULL
    `;
    const params: (string | number)[] = [...types, confidenceThreshold];
    const rows = this.db.prepare(sql).all(...params) as (GlobalKnowledgeRow & { embedding: Buffer; embedding_dim: number })[];

    // Fallback: no entries have embeddings
    if (rows.length === 0) {
      return this.getRelevantKnowledge({
        knowledgeType: types,
        limit,
        minConfidence: confidenceThreshold,
      });
    }

    // Compute cosine similarity and rank
    const scored = rows
      .map((row) => {
        const entryEmbedding = bufferToFloat32(row.embedding);
        const similarity = cosineSimilarity(queryEmbedding, entryEmbedding);
        return { row, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map(({ row }) => rowToKnowledge(row));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Generate an embedding for content and store it on the knowledge row.
   */
  private async generateAndStoreEmbedding(id: string, content: string): Promise<void> {
    if (!this.embeddingService || !this.embeddingModel) {
      return;
    }

    const embedding = await this.getOrCreateEmbedding(content);

    const embeddingBuffer = float32ToBuffer(embedding);
    this.db.prepare(`
      UPDATE global_knowledge
      SET embedding = ?, embedding_dim = ?, embedding_model = ?
      WHERE id = ?
    `).run(embeddingBuffer, embedding.length, this.embeddingModel, id);
  }

  /**
   * Get an embedding from cache or generate a new one via the embedding service.
   */
  private async getOrCreateEmbedding(text: string): Promise<Float32Array> {
    const model = this.embeddingModel!;

    // Check cache first
    if (this.embeddingCache) {
      const cached = this.embeddingCache.get(text, model);
      if (cached) {
        return cached;
      }
    }

    // Generate new embedding
    const embedding = await this.embeddingService!.embed(text);

    // Store in cache
    if (this.embeddingCache) {
      this.embeddingCache.set(text, model, embedding);
    }

    return embedding;
  }

  /**
   * If a near-duplicate already exists (same type + similar content), reinforce it.
   * Otherwise, record a new entry.
   */
  private recordOrReinforce(entry: GlobalKnowledgeEntry, _now: number): GlobalKnowledge {
    // Dedup: exact match on type + scope + content
    const scope = entry.scope ?? null;
    const existing = (scope === null
      ? this.db.prepare(
          'SELECT * FROM global_knowledge WHERE knowledge_type = ? AND scope IS NULL AND content = ? AND decayed_at IS NULL LIMIT 1'
        ).get(entry.knowledge_type, entry.content)
      : this.db.prepare(
          'SELECT * FROM global_knowledge WHERE knowledge_type = ? AND scope = ? AND content = ? AND decayed_at IS NULL LIMIT 1'
        ).get(entry.knowledge_type, scope, entry.content)
    ) as GlobalKnowledgeRow | undefined;

    if (existing) {
      this.reinforce(existing.id);
      return { ...rowToKnowledge(existing), occurrence_count: existing.occurrence_count + 1 };
    }

    return this.record(entry);
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function float32ToBuffer(value: Float32Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function bufferToFloat32(value: Buffer): Float32Array {
  const view = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new Float32Array(view);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function rowToKnowledge(row: GlobalKnowledgeRow): GlobalKnowledge {
  return {
    id: row.id,
    created_at: row.created_at,
    source_goal_id: row.source_goal_id,
    source_context_pack_id: row.source_context_pack_id,
    knowledge_type: row.knowledge_type as KnowledgeType,
    domain_tags: row.domain_tags ? JSON.parse(row.domain_tags) : [],
    scope: row.scope,
    content: row.content,
    confidence: row.confidence,
    occurrence_count: row.occurrence_count,
    last_reinforced_at: row.last_reinforced_at,
    decayed_at: row.decayed_at,
  };
}
