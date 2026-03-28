import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { GlobalKnowledgeService } from '../../../src/domain/knowledge/global-knowledge-service.js';
import type { ContextPack } from '../../../src/work-order/types/index.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

function insertGoal(db: Database.Database, goalId: string): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO goals (id, created_at, updated_at, title, description, success_criteria, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(goalId, now, now, 'Test Goal', 'Test', '[]', 'active', 50);
}

function makeContextPack(overrides?: Partial<{
  goalId: string;
  packId: string;
  pitfalls: string[];
  patterns: string[];
  approaches: string[];
}>): ContextPack {
  return {
    id: overrides?.packId ?? 'pack-1',
    created_at: Date.now(),
    goal_id: overrides?.goalId ?? 'goal-1',
    pack_type: 'daily_checkpoint',
    compressed: false,
    size_bytes: 100,
    snapshot_data: {
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
        pitfalls_discovered: overrides?.pitfalls ?? ['Never use eval()'],
        learned_patterns: overrides?.patterns ?? ['Prefer composition over inheritance'],
        successful_approaches: overrides?.approaches ?? ['Test-first development'],
      },
      next_actions: {
        recommended_work_items: [],
        risk_factors: [],
      },
    },
  };
}

describe('GlobalKnowledgeService', () => {
  let db: Database.Database;
  let service: GlobalKnowledgeService;

  beforeEach(() => {
    db = createDb();
    service = new GlobalKnowledgeService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('record', () => {
    it('creates a new knowledge entry with defaults', () => {
      const entry = service.record({
        knowledge_type: 'pitfall',
        content: 'Do not use eval in production',
      });

      expect(entry.id).toBeDefined();
      expect(entry.knowledge_type).toBe('pitfall');
      expect(entry.content).toBe('Do not use eval in production');
      expect(entry.confidence).toBe(0.5);
      expect(entry.occurrence_count).toBe(1);
      expect(entry.domain_tags).toEqual([]);
      expect(entry.source_goal_id).toBeNull();
      expect(entry.source_context_pack_id).toBeNull();
    });

    it('creates an entry with all fields specified', () => {
      insertGoal(db, 'goal-abc');
      const entry = service.record({
        knowledge_type: 'pattern',
        content: 'Use dependency injection',
        domain_tags: ['architecture', 'testing'],
        source_goal_id: 'goal-abc',
        source_context_pack_id: 'pack-xyz',
        confidence: 0.9,
      });

      expect(entry.knowledge_type).toBe('pattern');
      expect(entry.domain_tags).toEqual(['architecture', 'testing']);
      expect(entry.source_goal_id).toBe('goal-abc');
      expect(entry.source_context_pack_id).toBe('pack-xyz');
      expect(entry.confidence).toBe(0.9);
    });
  });

  describe('getById', () => {
    it('returns the entry when it exists', () => {
      const created = service.record({
        knowledge_type: 'approach',
        content: 'Start with integration tests',
      });

      const retrieved = service.getById(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.content).toBe('Start with integration tests');
    });

    it('returns null for non-existent id', () => {
      expect(service.getById('nonexistent')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all entries ordered by confidence desc', () => {
      service.record({ knowledge_type: 'pitfall', content: 'A', confidence: 0.3 });
      service.record({ knowledge_type: 'pattern', content: 'B', confidence: 0.9 });
      service.record({ knowledge_type: 'approach', content: 'C', confidence: 0.6 });

      const all = service.list();
      expect(all).toHaveLength(3);
      expect(all[0].content).toBe('B');
      expect(all[1].content).toBe('C');
      expect(all[2].content).toBe('A');
    });

    it('filters by knowledge type', () => {
      service.record({ knowledge_type: 'pitfall', content: 'A' });
      service.record({ knowledge_type: 'pattern', content: 'B' });

      const pitfalls = service.list({ knowledgeType: 'pitfall' });
      expect(pitfalls).toHaveLength(1);
      expect(pitfalls[0].content).toBe('A');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        service.record({ knowledge_type: 'pitfall', content: `Item ${i}` });
      }
      const limited = service.list({ limit: 2 });
      expect(limited).toHaveLength(2);
    });
  });

  describe('reinforce', () => {
    it('increments occurrence_count and bumps confidence', () => {
      const entry = service.record({
        knowledge_type: 'pitfall',
        content: 'Avoid circular imports',
        confidence: 0.5,
      });

      service.reinforce(entry.id);

      const updated = service.getById(entry.id)!;
      expect(updated.occurrence_count).toBe(2);
      expect(updated.confidence).toBe(0.6);
    });

    it('caps confidence at 1.0', () => {
      const entry = service.record({
        knowledge_type: 'pitfall',
        content: 'Test',
        confidence: 0.95,
      });

      service.reinforce(entry.id);
      const updated = service.getById(entry.id)!;
      expect(updated.confidence).toBe(1.0);
    });
  });

  describe('getRelevantKnowledge', () => {
    it('returns entries above minimum confidence', () => {
      service.record({ knowledge_type: 'pitfall', content: 'Low confidence', confidence: 0.1 });
      service.record({ knowledge_type: 'pitfall', content: 'High confidence', confidence: 0.8 });

      const relevant = service.getRelevantKnowledge({ minConfidence: 0.5 });
      expect(relevant).toHaveLength(1);
      expect(relevant[0].content).toBe('High confidence');
    });

    it('filters by knowledge type', () => {
      service.record({ knowledge_type: 'pitfall', content: 'P1' });
      service.record({ knowledge_type: 'pattern', content: 'P2' });

      const patterns = service.getRelevantKnowledge({ knowledgeType: 'pattern' });
      expect(patterns).toHaveLength(1);
      expect(patterns[0].content).toBe('P2');
    });

    it('filters by domain tags (client-side)', () => {
      service.record({ knowledge_type: 'pitfall', content: 'DB pitfall', domain_tags: ['database'] });
      service.record({ knowledge_type: 'pitfall', content: 'API pitfall', domain_tags: ['api'] });

      const dbOnly = service.getRelevantKnowledge({ domainTags: ['database'] });
      expect(dbOnly).toHaveLength(1);
      expect(dbOnly[0].content).toBe('DB pitfall');
    });

    it('tag filtering is case-insensitive', () => {
      service.record({ knowledge_type: 'pitfall', content: 'Test', domain_tags: ['Database'] });

      const results = service.getRelevantKnowledge({ domainTags: ['database'] });
      expect(results).toHaveLength(1);
    });
  });

  describe('extractFromContextPack', () => {
    it('extracts all knowledge types from a context pack', () => {
      insertGoal(db, 'goal-1');
      const pack = makeContextPack({
        pitfalls: ['Pitfall A', 'Pitfall B'],
        patterns: ['Pattern A'],
        approaches: ['Approach A'],
      });

      const extracted = service.extractFromContextPack(pack);
      expect(extracted).toHaveLength(4);

      const types = extracted.map(e => e.knowledge_type);
      expect(types.filter(t => t === 'pitfall')).toHaveLength(2);
      expect(types.filter(t => t === 'pattern')).toHaveLength(1);
      expect(types.filter(t => t === 'approach')).toHaveLength(1);
    });

    it('sets source_goal_id and source_context_pack_id', () => {
      insertGoal(db, 'goal-42');
      const pack = makeContextPack({
        goalId: 'goal-42',
        packId: 'pack-99',
        pitfalls: ['Something bad'],
        patterns: [],
        approaches: [],
      });

      const extracted = service.extractFromContextPack(pack);
      expect(extracted).toHaveLength(1);
      expect(extracted[0].source_goal_id).toBe('goal-42');
      expect(extracted[0].source_context_pack_id).toBe('pack-99');
    });

    it('deduplicates by reinforcing existing entries with same content', () => {
      insertGoal(db, 'goal-1');
      const pack = makeContextPack({
        pitfalls: ['Repeated pitfall'],
        patterns: [],
        approaches: [],
      });

      // First extraction
      service.extractFromContextPack(pack);
      // Second extraction — should reinforce, not create new
      service.extractFromContextPack(pack);

      const all = service.list({ knowledgeType: 'pitfall' });
      expect(all).toHaveLength(1);
      expect(all[0].occurrence_count).toBeGreaterThanOrEqual(2);
    });

    it('handles empty knowledge base gracefully', () => {
      insertGoal(db, 'goal-1');
      const pack = makeContextPack({
        pitfalls: [],
        patterns: [],
        approaches: [],
      });

      const extracted = service.extractFromContextPack(pack);
      expect(extracted).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('returns zero stats when empty', () => {
      const stats = service.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byType).toEqual({ pitfall: 0, pattern: 0, approach: 0, decision: 0 });
      expect(stats.avgConfidence).toBe(0);
    });

    it('returns correct stats with entries', () => {
      service.record({ knowledge_type: 'pitfall', content: 'A', confidence: 0.4 });
      service.record({ knowledge_type: 'pitfall', content: 'B', confidence: 0.6 });
      service.record({ knowledge_type: 'pattern', content: 'C', confidence: 0.8 });

      const stats = service.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byType.pitfall).toBe(2);
      expect(stats.byType.pattern).toBe(1);
      expect(stats.byType.approach).toBe(0);
      expect(stats.avgConfidence).toBeCloseTo(0.6, 1);
    });
  });
});

describe('global_knowledge schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates global_knowledge table', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'global_knowledge'")
      .get();
    expect(row).toBeDefined();
  });

  it('creates required indexes', () => {
    const indexes = ['idx_global_knowledge_type', 'idx_global_knowledge_confidence', 'idx_global_knowledge_source_goal'];
    for (const idx of indexes) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(idx);
      expect(row).toBeDefined();
    }
  });

  it('has correct columns', () => {
    const columns = db.prepare("SELECT name FROM pragma_table_info('global_knowledge')").all() as { name: string }[];
    const names = columns.map(c => c.name);

    expect(names).toContain('id');
    expect(names).toContain('created_at');
    expect(names).toContain('source_goal_id');
    expect(names).toContain('source_context_pack_id');
    expect(names).toContain('knowledge_type');
    expect(names).toContain('domain_tags');
    expect(names).toContain('content');
    expect(names).toContain('confidence');
    expect(names).toContain('occurrence_count');
    expect(names).toContain('last_reinforced_at');
  });

  it('enforces knowledge_type CHECK constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at)
        VALUES ('test', 1, 'invalid_type', 'test', 0.5, 1, 1)
      `).run();
    }).toThrow();
  });

  it('schema version is 1.4.0', () => {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe('1.4.0');
  });
});
