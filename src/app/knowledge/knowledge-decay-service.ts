/**
 * KnowledgeDecayService
 *
 * Implements knowledge lifecycle management for the global_knowledge store:
 * - Age-based confidence decay for stale, low-occurrence entries
 * - Semantic deduplication of near-identical entries
 *
 * All operations are soft-delete only (set decayed_at = NOW).
 * No hard DELETE is ever performed.
 */

import type Database from 'better-sqlite3';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGE_DECAY_THRESHOLD_DAYS = 90;
const CONFIDENCE_DECAY_AMOUNT = 0.15;
const CONFIDENCE_SOFT_DELETE_THRESHOLD = 0.1;
const SEMANTIC_DEDUP_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DecayResult {
  confidenceReduced: number;
  decayed: number;
}

export interface DeduplicationResult {
  merged: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class KnowledgeDecayService {
  private readonly logger: ILogger;

  constructor(
    private readonly db: Database.Database,
    logger?: ILogger,
  ) {
    this.logger = logger ?? new NoopLogger();
  }

  /**
   * Apply age-based confidence decay:
   * - Entries older than 90 days (by last_reinforced_at) with occurrence_count < 3:
   *   reduce confidence by 0.15 (floored at 0).
   * - Entries whose confidence falls below 0.1 after reduction: set decayed_at = NOW
   *   (soft delete).
   */
  applyAgeDecay(): DecayResult {
    const now = Date.now();
    const ageThresholdMs = AGE_DECAY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const cutoffTimestamp = now - ageThresholdMs;

    // Step 1: Reduce confidence on qualifying entries
    const reduceResult = this.db.prepare(`
      UPDATE global_knowledge
      SET confidence = MAX(0, confidence - ?)
      WHERE decayed_at IS NULL
        AND last_reinforced_at < ?
        AND occurrence_count < 3
    `).run(CONFIDENCE_DECAY_AMOUNT, cutoffTimestamp);

    const confidenceReduced = reduceResult.changes;

    // Step 2: Soft-delete entries that fell below the threshold
    const decayResult = this.db.prepare(`
      UPDATE global_knowledge
      SET decayed_at = ?
      WHERE decayed_at IS NULL
        AND confidence < ?
    `).run(now, CONFIDENCE_SOFT_DELETE_THRESHOLD);

    const decayed = decayResult.changes;

    this.logger.info(
      { event: 'knowledge_decay_applied', confidenceReduced, decayed },
      `Knowledge decay: ${confidenceReduced} entries reduced, ${decayed} entries soft-deleted`,
    );

    return { confidenceReduced, decayed };
  }

  /**
   * Semantic deduplication: for entries within the same knowledge_type whose
   * cosine similarity exceeds the threshold (default 0.95), keep the one with
   * higher confidence (then higher occurrence_count) and soft-delete the rest.
   *
   * Only processes entries that have embeddings.
   */
  deduplicateSemantically(similarityThreshold: number = SEMANTIC_DEDUP_THRESHOLD): DeduplicationResult {
    // Load all active entries with embeddings, ordered strongest-first
    const rows = this.db.prepare(`
      SELECT id, knowledge_type, confidence, occurrence_count, embedding
      FROM global_knowledge
      WHERE decayed_at IS NULL AND embedding IS NOT NULL
      ORDER BY confidence DESC, occurrence_count DESC
    `).all() as Array<{
      id: string;
      knowledge_type: string;
      confidence: number;
      occurrence_count: number;
      embedding: Buffer;
    }>;

    const decayedIds = new Set<string>();
    const now = Date.now();

    // Compare all pairs within the same knowledge_type
    for (let i = 0; i < rows.length; i++) {
      if (decayedIds.has(rows[i].id)) continue;

      for (let j = i + 1; j < rows.length; j++) {
        if (decayedIds.has(rows[j].id)) continue;
        if (rows[i].knowledge_type !== rows[j].knowledge_type) continue;

        const embA = bufferToFloat32(rows[i].embedding);
        const embB = bufferToFloat32(rows[j].embedding);
        const similarity = cosineSimilarity(embA, embB);

        if (similarity >= similarityThreshold) {
          // rows[j] is the weaker entry (sorted strongest-first)
          decayedIds.add(rows[j].id);
        }
      }
    }

    // Soft-delete duplicates in a single transaction
    if (decayedIds.size > 0) {
      const stmt = this.db.prepare('UPDATE global_knowledge SET decayed_at = ? WHERE id = ?');
      const updateMany = this.db.transaction((ids: string[]) => {
        for (const id of ids) {
          stmt.run(now, id);
        }
      });
      updateMany([...decayedIds]);
    }

    this.logger.info(
      { event: 'knowledge_dedup_applied', merged: decayedIds.size },
      `Knowledge dedup: ${decayedIds.size} duplicate entries soft-deleted`,
    );

    return { merged: decayedIds.size };
  }

  /**
   * Get the count of active (non-decayed) entries.
   */
  getActiveEntryCount(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM global_knowledge WHERE decayed_at IS NULL',
    ).get() as { cnt: number };
    return row.cnt;
  }
}

// ---------------------------------------------------------------------------
// Helpers (same algorithms as global-knowledge-service.ts)
// ---------------------------------------------------------------------------

function bufferToFloat32(value: Buffer): Float32Array {
  const view = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new Float32Array(view);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
