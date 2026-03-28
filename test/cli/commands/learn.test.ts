/**
 * Unit tests for `pb learn` command logic.
 *
 * Tests the core extraction and query logic that the learn command exercises,
 * NOT the commander CLI integration or console output formatting.
 *
 * The learn command's action handler is tightly coupled to commander, so we
 * test the same logical path by:
 * 1. Setting up an in-memory DB with the full schema
 * 2. Inserting goals and context_packs rows (as the command would read them)
 * 3. Exercising GlobalKnowledgeService.extractFromContextPack (the write path)
 * 4. Verifying the DB queries the command uses for pack retrieval
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { GlobalKnowledgeService } from '../../../src/domain/knowledge/global-knowledge-service.js';
import type { ContextPack, ContextPackRow } from '../../../src/work-order/types/index.js';

// ---------------------------------------------------------------------------
// Helpers (mirrored from existing test patterns)
// ---------------------------------------------------------------------------

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

function insertGoal(db: Database.Database, goalId: string, status = 'active'): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO goals (id, created_at, updated_at, title, description, success_criteria, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(goalId, now, now, 'Test Goal', 'Test description', '[]', status, 50);
}

function insertContextPackRow(
  db: Database.Database,
  opts: {
    packId: string;
    goalId: string;
    pitfalls?: string[];
    patterns?: string[];
    approaches?: string[];
    createdAt?: number;
  },
): void {
  const snapshotData = {
    goal_state: {
      current_work_items: [],
      completed_work_items: [],
      blocked_work_items: [],
      recent_decisions: [],
      active_escalations: [],
    },
    execution_summary: {
      total_runs: 1,
      success_count: 1,
      failure_count: 0,
      most_common_errors: [],
    },
    knowledge_base: {
      pitfalls_discovered: opts.pitfalls ?? [],
      learned_patterns: opts.patterns ?? [],
      successful_approaches: opts.approaches ?? [],
    },
    next_actions: {
      recommended_work_items: [],
      risk_factors: [],
    },
  };

  db.prepare(`
    INSERT INTO context_packs (id, created_at, goal_id, pack_type, snapshot_data, compressed, size_bytes, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.packId,
    opts.createdAt ?? Date.now(),
    opts.goalId,
    'daily_checkpoint',
    JSON.stringify(snapshotData),
    0,
    100,
    null,
  );
}

/**
 * Parse a ContextPackRow from the DB the same way learn.ts does.
 * This mirrors the `parseContextPackRow` function in learn.ts.
 */
function parseContextPackRow(row: ContextPackRow): ContextPack {
  return {
    ...row,
    snapshot_data: JSON.parse(row.snapshot_data),
    compressed: Boolean(row.compressed),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pb learn command logic', () => {
  let db: Database.Database;
  let service: GlobalKnowledgeService;

  beforeEach(() => {
    db = createDb();
    service = new GlobalKnowledgeService(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // Single-goal extraction (--goal <id>)
  // -------------------------------------------------------------------------

  describe('single-goal extraction', () => {
    it('extracts knowledge from a specific goal context pack', () => {
      insertGoal(db, 'goal-1');
      insertContextPackRow(db, {
        packId: 'pack-1',
        goalId: 'goal-1',
        pitfalls: ['Never use eval()'],
        patterns: ['Prefer composition over inheritance'],
        approaches: ['Test-first development'],
      });

      // Simulate the query learn.ts runs for --goal
      const row = db.prepare(
        'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get('goal-1') as ContextPackRow | undefined;

      expect(row).toBeDefined();
      const pack = parseContextPackRow(row!);

      const extracted = service.extractFromContextPack(pack);
      expect(extracted).toHaveLength(3);

      const types = extracted.map(e => e.knowledge_type);
      expect(types).toContain('pitfall');
      expect(types).toContain('pattern');
      expect(types).toContain('approach');

      // Verify they are persisted
      const all = service.list();
      expect(all).toHaveLength(3);
    });

    it('uses the most recent context pack when multiple exist for a goal', () => {
      insertGoal(db, 'goal-1');

      // Older pack
      insertContextPackRow(db, {
        packId: 'pack-old',
        goalId: 'goal-1',
        pitfalls: ['Old pitfall'],
        createdAt: 1000,
      });

      // Newer pack
      insertContextPackRow(db, {
        packId: 'pack-new',
        goalId: 'goal-1',
        pitfalls: ['New pitfall'],
        patterns: ['New pattern'],
        createdAt: 2000,
      });

      const row = db.prepare(
        'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get('goal-1') as ContextPackRow | undefined;

      expect(row).toBeDefined();
      expect(row!.id).toBe('pack-new');

      const pack = parseContextPackRow(row!);
      const extracted = service.extractFromContextPack(pack);
      expect(extracted).toHaveLength(2);
      expect(extracted.map(e => e.content)).toContain('New pitfall');
      expect(extracted.map(e => e.content)).toContain('New pattern');
    });
  });

  // -------------------------------------------------------------------------
  // All-goals extraction (--all)
  // -------------------------------------------------------------------------

  describe('all-goals extraction', () => {
    it('gets the latest context pack per goal', () => {
      insertGoal(db, 'goal-A');
      insertGoal(db, 'goal-B');

      insertContextPackRow(db, {
        packId: 'pack-A1',
        goalId: 'goal-A',
        pitfalls: ['Pitfall from A old'],
        createdAt: 1000,
      });
      insertContextPackRow(db, {
        packId: 'pack-A2',
        goalId: 'goal-A',
        pitfalls: ['Pitfall from A new'],
        createdAt: 2000,
      });
      insertContextPackRow(db, {
        packId: 'pack-B1',
        goalId: 'goal-B',
        patterns: ['Pattern from B'],
        createdAt: 1500,
      });

      // Simulate the --all query from learn.ts
      const rows = db.prepare(`
        SELECT cp.* FROM context_packs cp
        INNER JOIN (
          SELECT goal_id, MAX(created_at) as max_created
          FROM context_packs
          GROUP BY goal_id
        ) latest ON cp.goal_id = latest.goal_id AND cp.created_at = latest.max_created
        ORDER BY cp.created_at DESC
      `).all() as ContextPackRow[];

      expect(rows).toHaveLength(2);

      // Should be ordered by created_at DESC: pack-A2 (2000) then pack-B1 (1500)
      expect(rows[0].id).toBe('pack-A2');
      expect(rows[1].id).toBe('pack-B1');

      const packs = rows.map(parseContextPackRow);
      let totalExtracted = 0;
      for (const pack of packs) {
        const extracted = service.extractFromContextPack(pack);
        totalExtracted += extracted.length;
      }

      expect(totalExtracted).toBe(2); // 1 pitfall from A-new + 1 pattern from B

      const all = service.list();
      expect(all).toHaveLength(2);
    });

    it('extracts knowledge from multiple goals with varied knowledge types', () => {
      insertGoal(db, 'goal-1');
      insertGoal(db, 'goal-2');
      insertGoal(db, 'goal-3');

      insertContextPackRow(db, {
        packId: 'pack-1',
        goalId: 'goal-1',
        pitfalls: ['Avoid circular imports', 'Never hardcode secrets'],
        createdAt: 1000,
      });
      insertContextPackRow(db, {
        packId: 'pack-2',
        goalId: 'goal-2',
        patterns: ['Use factory pattern for complex creation'],
        approaches: ['Integration tests before unit tests'],
        createdAt: 2000,
      });
      insertContextPackRow(db, {
        packId: 'pack-3',
        goalId: 'goal-3',
        pitfalls: ['Avoid circular imports'], // duplicate of goal-1's pitfall
        approaches: ['Schema-first API design'],
        createdAt: 3000,
      });

      const rows = db.prepare(`
        SELECT cp.* FROM context_packs cp
        INNER JOIN (
          SELECT goal_id, MAX(created_at) as max_created
          FROM context_packs
          GROUP BY goal_id
        ) latest ON cp.goal_id = latest.goal_id AND cp.created_at = latest.max_created
        ORDER BY cp.created_at DESC
      `).all() as ContextPackRow[];

      const packs = rows.map(parseContextPackRow);
      for (const pack of packs) {
        service.extractFromContextPack(pack);
      }

      // "Avoid circular imports" appears twice but should be deduplicated
      const pitfalls = service.list({ knowledgeType: 'pitfall' });
      expect(pitfalls).toHaveLength(2); // 'Avoid circular imports' + 'Never hardcode secrets'

      // The deduplicated pitfall should have occurrence_count >= 2
      const reinforced = pitfalls.find(p => p.content === 'Avoid circular imports');
      expect(reinforced).toBeDefined();
      expect(reinforced!.occurrence_count).toBeGreaterThanOrEqual(2);

      const patterns = service.list({ knowledgeType: 'pattern' });
      expect(patterns).toHaveLength(1);

      const approaches = service.list({ knowledgeType: 'approach' });
      expect(approaches).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Dry-run mode (--dry-run)
  // -------------------------------------------------------------------------

  describe('dry-run mode', () => {
    it('does not write to the database when simulating dry-run', () => {
      insertGoal(db, 'goal-1');
      insertContextPackRow(db, {
        packId: 'pack-1',
        goalId: 'goal-1',
        pitfalls: ['Pitfall A'],
        patterns: ['Pattern B'],
        approaches: ['Approach C'],
      });

      const row = db.prepare(
        'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get('goal-1') as ContextPackRow | undefined;

      const pack = parseContextPackRow(row!);
      const kb = pack.snapshot_data.knowledge_base;

      // In dry-run mode, learn.ts counts items but does NOT call extractFromContextPack
      const dryRunCount =
        kb.pitfalls_discovered.length +
        kb.learned_patterns.length +
        kb.successful_approaches.length;

      expect(dryRunCount).toBe(3);

      // Verify nothing was written to global_knowledge
      const stats = service.getStats();
      expect(stats.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Missing goal (no context pack found)
  // -------------------------------------------------------------------------

  describe('missing goal handling', () => {
    it('returns no row when goal has no context packs', () => {
      insertGoal(db, 'goal-1');
      // No context pack inserted

      const row = db.prepare(
        'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get('goal-1') as ContextPackRow | undefined;

      expect(row).toBeUndefined();
    });

    it('returns no row for a non-existent goal', () => {
      const row = db.prepare(
        'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get('nonexistent-goal') as ContextPackRow | undefined;

      expect(row).toBeUndefined();
    });

    it('returns empty array for --all when no context packs exist', () => {
      insertGoal(db, 'goal-1');
      insertGoal(db, 'goal-2');

      const rows = db.prepare(`
        SELECT cp.* FROM context_packs cp
        INNER JOIN (
          SELECT goal_id, MAX(created_at) as max_created
          FROM context_packs
          GROUP BY goal_id
        ) latest ON cp.goal_id = latest.goal_id AND cp.created_at = latest.max_created
        ORDER BY cp.created_at DESC
      `).all() as ContextPackRow[];

      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Goals with empty knowledge_base
  // -------------------------------------------------------------------------

  describe('goals with empty knowledge_base', () => {
    it('extracts nothing from a context pack with empty knowledge arrays', () => {
      insertGoal(db, 'goal-1');
      insertContextPackRow(db, {
        packId: 'pack-1',
        goalId: 'goal-1',
        pitfalls: [],
        patterns: [],
        approaches: [],
      });

      const row = db.prepare(
        'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
      ).get('goal-1') as ContextPackRow | undefined;

      const pack = parseContextPackRow(row!);
      const kb = pack.snapshot_data.knowledge_base;
      const itemCount =
        kb.pitfalls_discovered.length +
        kb.learned_patterns.length +
        kb.successful_approaches.length;

      expect(itemCount).toBe(0);

      // Even if we call extract, it should return empty
      const extracted = service.extractFromContextPack(pack);
      expect(extracted).toHaveLength(0);
    });

    it('skips empty goals but processes non-empty ones in --all mode', () => {
      insertGoal(db, 'goal-empty');
      insertGoal(db, 'goal-full');

      insertContextPackRow(db, {
        packId: 'pack-empty',
        goalId: 'goal-empty',
        pitfalls: [],
        patterns: [],
        approaches: [],
      });

      insertContextPackRow(db, {
        packId: 'pack-full',
        goalId: 'goal-full',
        pitfalls: ['Real pitfall'],
        patterns: ['Real pattern'],
      });

      const rows = db.prepare(`
        SELECT cp.* FROM context_packs cp
        INNER JOIN (
          SELECT goal_id, MAX(created_at) as max_created
          FROM context_packs
          GROUP BY goal_id
        ) latest ON cp.goal_id = latest.goal_id AND cp.created_at = latest.max_created
        ORDER BY cp.created_at DESC
      `).all() as ContextPackRow[];

      const packs = rows.map(parseContextPackRow);
      let totalExtracted = 0;

      for (const pack of packs) {
        const kb = pack.snapshot_data.knowledge_base;
        const itemCount =
          kb.pitfalls_discovered.length +
          kb.learned_patterns.length +
          kb.successful_approaches.length;

        if (itemCount === 0) continue; // learn.ts skips these

        const extracted = service.extractFromContextPack(pack);
        totalExtracted += extracted.length;
      }

      expect(totalExtracted).toBe(2); // 1 pitfall + 1 pattern from goal-full
      expect(service.getStats().total).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Stats after extraction (used by learn.ts in non-dry-run mode)
  // -------------------------------------------------------------------------

  describe('stats after extraction', () => {
    it('reports correct stats after processing multiple goals', () => {
      insertGoal(db, 'goal-1');
      insertGoal(db, 'goal-2');

      insertContextPackRow(db, {
        packId: 'pack-1',
        goalId: 'goal-1',
        pitfalls: ['Pitfall 1', 'Pitfall 2'],
        patterns: ['Pattern 1'],
      });

      insertContextPackRow(db, {
        packId: 'pack-2',
        goalId: 'goal-2',
        approaches: ['Approach 1'],
      });

      const rows = db.prepare(`
        SELECT cp.* FROM context_packs cp
        INNER JOIN (
          SELECT goal_id, MAX(created_at) as max_created
          FROM context_packs
          GROUP BY goal_id
        ) latest ON cp.goal_id = latest.goal_id AND cp.created_at = latest.max_created
        ORDER BY cp.created_at DESC
      `).all() as ContextPackRow[];

      for (const row of rows) {
        service.extractFromContextPack(parseContextPackRow(row));
      }

      const stats = service.getStats();
      expect(stats.total).toBe(4);
      expect(stats.byType.pitfall).toBe(2);
      expect(stats.byType.pattern).toBe(1);
      expect(stats.byType.approach).toBe(1);
      expect(stats.byType.decision).toBe(0);
      expect(stats.avgConfidence).toBeCloseTo(0.5, 1);
    });
  });
});
