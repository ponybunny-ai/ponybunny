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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KnowledgeType = 'pitfall' | 'pattern' | 'approach' | 'decision';

export interface GlobalKnowledge {
  id: string;
  created_at: number;
  source_goal_id: string | null;
  source_context_pack_id: string | null;
  knowledge_type: KnowledgeType;
  domain_tags: string[];
  content: string;
  confidence: number;
  occurrence_count: number;
  last_reinforced_at: number;
}

export interface GlobalKnowledgeEntry {
  knowledge_type: KnowledgeType;
  content: string;
  domain_tags?: string[];
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
  content: string;
  confidence: number;
  occurrence_count: number;
  last_reinforced_at: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GlobalKnowledgeService {
  constructor(private db: Database.Database) {}

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
    knowledgeType?: KnowledgeType;
    domainTags?: string[];
    limit?: number;
    minConfidence?: number;
  }): GlobalKnowledge[] {
    const limit = options?.limit ?? 10;
    const minConfidence = options?.minConfidence ?? 0.0;

    let sql = `SELECT * FROM global_knowledge WHERE confidence >= ?`;
    const params: (string | number)[] = [minConfidence];

    if (options?.knowledgeType) {
      sql += ` AND knowledge_type = ?`;
      params.push(options.knowledgeType);
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
   * Record a new knowledge entry.
   */
  record(entry: GlobalKnowledgeEntry): GlobalKnowledge {
    const now = Date.now();
    const id = randomUUID();
    const row: GlobalKnowledgeRow = {
      id,
      created_at: now,
      source_goal_id: entry.source_goal_id ?? null,
      source_context_pack_id: entry.source_context_pack_id ?? null,
      knowledge_type: entry.knowledge_type,
      domain_tags: JSON.stringify(entry.domain_tags ?? []),
      content: entry.content,
      confidence: entry.confidence ?? 0.5,
      occurrence_count: 1,
      last_reinforced_at: now,
    };

    this.db.prepare(`
      INSERT INTO global_knowledge
        (id, created_at, source_goal_id, source_context_pack_id,
         knowledge_type, domain_tags, content, confidence,
         occurrence_count, last_reinforced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.created_at, row.source_goal_id, row.source_context_pack_id,
      row.knowledge_type, row.domain_tags, row.content, row.confidence,
      row.occurrence_count, row.last_reinforced_at
    );

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
    let sql = 'SELECT * FROM global_knowledge';
    const params: (string | number)[] = [];

    if (options?.knowledgeType) {
      sql += ' WHERE knowledge_type = ?';
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
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM global_knowledge').get() as { count: number }).count;
    const byTypeRows = this.db.prepare(
      'SELECT knowledge_type, COUNT(*) as count FROM global_knowledge GROUP BY knowledge_type'
    ).all() as { knowledge_type: string; count: number }[];

    const byType: Record<KnowledgeType, number> = { pitfall: 0, pattern: 0, approach: 0, decision: 0 };
    for (const row of byTypeRows) {
      byType[row.knowledge_type as KnowledgeType] = row.count;
    }

    const avgRow = this.db.prepare('SELECT AVG(confidence) as avg FROM global_knowledge').get() as { avg: number | null };

    return { total, byType, avgConfidence: avgRow.avg ?? 0 };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * If a near-duplicate already exists (same type + similar content), reinforce it.
   * Otherwise, record a new entry.
   */
  private recordOrReinforce(entry: GlobalKnowledgeEntry, _now: number): GlobalKnowledge {
    // Simple dedup: exact content match within the same knowledge_type
    const existing = this.db.prepare(
      'SELECT * FROM global_knowledge WHERE knowledge_type = ? AND content = ? LIMIT 1'
    ).get(entry.knowledge_type, entry.content) as GlobalKnowledgeRow | undefined;

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

function rowToKnowledge(row: GlobalKnowledgeRow): GlobalKnowledge {
  return {
    id: row.id,
    created_at: row.created_at,
    source_goal_id: row.source_goal_id,
    source_context_pack_id: row.source_context_pack_id,
    knowledge_type: row.knowledge_type as KnowledgeType,
    domain_tags: row.domain_tags ? JSON.parse(row.domain_tags) : [],
    content: row.content,
    confidence: row.confidence,
    occurrence_count: row.occurrence_count,
    last_reinforced_at: row.last_reinforced_at,
  };
}
