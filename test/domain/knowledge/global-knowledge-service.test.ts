import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { GlobalKnowledgeService } from '../../../src/domain/knowledge/global-knowledge-service.js';
import type { ContextPack } from '../../../src/work-order/types/index.js';
import type { IEmbeddingService } from '../../../src/app/conversation/memory-service.js';
import { EmbeddingLruCache } from '../../../src/infra/persistence/embedding-lru-cache.js';

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

    it('accepts an array of knowledge types', () => {
      service.record({ knowledge_type: 'pitfall', content: 'P1' });
      service.record({ knowledge_type: 'constraint', content: 'C1' });
      service.record({ knowledge_type: 'pattern', content: 'P2' });

      const results = service.getRelevantKnowledge({ knowledgeType: ['pitfall', 'constraint'] });
      expect(results).toHaveLength(2);
      const types = results.map(r => r.knowledge_type);
      expect(types).toContain('pitfall');
      expect(types).toContain('constraint');
    });

    it('excludes decayed entries', () => {
      const entry = service.record({ knowledge_type: 'pitfall', content: 'Decayed entry' });
      // Manually decay it
      db.prepare('UPDATE global_knowledge SET decayed_at = ? WHERE id = ?').run(Date.now(), entry.id);

      const results = service.getRelevantKnowledge({ knowledgeType: 'pitfall' });
      expect(results).toHaveLength(0);
    });
  });

  describe('scope dedup', () => {
    it('deduplicates on type + scope + content via record()', () => {
      service.record({ knowledge_type: 'pitfall', content: 'Watch out', scope: 'github-api' });
      const second = service.record({ knowledge_type: 'pitfall', content: 'Watch out', scope: 'github-api' });

      const all = service.list({ knowledgeType: 'pitfall' });
      expect(all).toHaveLength(1);
      expect(all[0].scope).toBe('github-api');
      expect(second.occurrence_count).toBe(2);
    });

    it('allows same content with different scopes', () => {
      service.record({ knowledge_type: 'pitfall', content: 'Watch out', scope: 'github-api' });
      service.record({ knowledge_type: 'pitfall', content: 'Watch out', scope: 'nodejs-fs' });

      const all = service.list({ knowledgeType: 'pitfall' });
      expect(all).toHaveLength(2);
    });

    it('treats null scope and non-null scope as different entries', () => {
      service.record({ knowledge_type: 'pitfall', content: 'Watch out' });
      service.record({ knowledge_type: 'pitfall', content: 'Watch out', scope: 'github-api' });

      const all = service.list({ knowledgeType: 'pitfall' });
      expect(all).toHaveLength(2);
    });

    it('records scope as null when not provided', () => {
      const entry = service.record({ knowledge_type: 'constraint', content: 'No eval' });
      expect(entry.scope).toBeNull();
    });

    it('records new knowledge types correctly', () => {
      const entry = service.record({ knowledge_type: 'failure_mode', content: 'OOM on large inputs', scope: 'memory' });
      expect(entry.knowledge_type).toBe('failure_mode');
      expect(entry.scope).toBe('memory');

      const retrieved = service.getById(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.knowledge_type).toBe('failure_mode');
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
      expect(stats.byType).toEqual({
        pitfall: 0, pattern: 0, approach: 0, decision: 0,
        constraint: 0, failure_mode: 0, time_estimate: 0, tool_preference: 0,
      });
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

describe('GlobalKnowledgeService — semantic retrieval', () => {
  let db: Database.Database;

  function makeMockEmbeddingService(embedFn?: (text: string) => Promise<Float32Array>): IEmbeddingService {
    const defaultEmbed = async (text: string): Promise<Float32Array> => {
      // Deterministic hash-based embedding for testing
      const vec = new Float32Array(4);
      for (let i = 0; i < text.length; i++) {
        vec[i % 4] += text.charCodeAt(i) / 256;
      }
      // Normalize
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
      const len = Math.sqrt(norm);
      if (len > 0) for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / len;
      return vec;
    };
    return {
      model: 'test-model',
      dimensions: 4,
      embed: embedFn ?? defaultEmbed,
    };
  }

  function makeMockCache(): EmbeddingLruCache {
    return new EmbeddingLruCache({
      maxEntries: 100,
      sqliteGet: () => null,
      sqliteSet: () => {},
    });
  }

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('record() works without embedding deps (backward compat)', () => {
    const service = new GlobalKnowledgeService(db);
    const entry = service.record({
      knowledge_type: 'pitfall',
      content: 'No eval in production',
    });
    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('No eval in production');
  });

  it('record() fires embedding generation when deps are provided', async () => {
    const embedCalls: string[] = [];
    const embeddingService = makeMockEmbeddingService(async (text) => {
      embedCalls.push(text);
      return new Float32Array([0.5, 0.5, 0.5, 0.5]);
    });

    const service = new GlobalKnowledgeService(db, {
      embeddingService,
      embeddingModel: 'test-model',
    });

    const entry = service.record({
      knowledge_type: 'pitfall',
      content: 'GitHub API rate limit 5000 req/hr',
    });

    // Wait for the fire-and-forget promise to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(embedCalls).toContain('GitHub API rate limit 5000 req/hr');

    // Verify embedding was stored in the DB
    const row = db.prepare('SELECT embedding, embedding_dim, embedding_model FROM global_knowledge WHERE id = ?').get(entry.id) as { embedding: Buffer | null; embedding_dim: number | null; embedding_model: string | null };
    expect(row.embedding).not.toBeNull();
    expect(row.embedding_dim).toBe(4);
    expect(row.embedding_model).toBe('test-model');
  });

  it('record() does not fail when embedding generation throws', async () => {
    const embeddingService = makeMockEmbeddingService(async () => {
      throw new Error('API error');
    });

    const service = new GlobalKnowledgeService(db, {
      embeddingService,
      embeddingModel: 'test-model',
    });

    // record() must not throw
    const entry = service.record({
      knowledge_type: 'pitfall',
      content: 'Some content',
    });
    expect(entry.id).toBeDefined();

    // Wait for the fire-and-forget promise to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    // Embedding should NOT be stored
    const row = db.prepare('SELECT embedding FROM global_knowledge WHERE id = ?').get(entry.id) as { embedding: Buffer | null };
    expect(row.embedding).toBeNull();
  });

  describe('getRelevantKnowledgeSemantic', () => {
    it('falls back to tag-based when no embedding service configured', async () => {
      const service = new GlobalKnowledgeService(db);
      service.record({ knowledge_type: 'pitfall', content: 'High conf pitfall', confidence: 0.8 });
      service.record({ knowledge_type: 'pitfall', content: 'Low conf pitfall', confidence: 0.3 });

      const results = await service.getRelevantKnowledgeSemantic('some query', ['pitfall'], 10, 0.5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('High conf pitfall');
    });

    it('falls back to tag-based when no entries have embeddings', async () => {
      const embeddingService = makeMockEmbeddingService();
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingModel: 'test-model',
      });

      // Record without embeddings (manually, bypassing async generation)
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at)
        VALUES ('k1', ?, 'pitfall', 'Some pitfall', 0.8, 1, ?)
      `).run(Date.now(), Date.now());

      const results = await service.getRelevantKnowledgeSemantic('query', ['pitfall'], 10, 0.5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Some pitfall');
    });

    it('returns results ranked by cosine similarity', async () => {
      const embeddingService = makeMockEmbeddingService();
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingModel: 'test-model',
      });

      // Insert entries with pre-computed embeddings directly
      const now = Date.now();
      const queryVec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
      const closeVec = new Float32Array([0.9, 0.1, 0.0, 0.0]);  // high similarity
      const farVec = new Float32Array([0.0, 0.0, 0.0, 1.0]);    // low similarity

      // Override embed to return queryVec for any query
      (embeddingService as { embed: (t: string) => Promise<Float32Array> }).embed = async () => queryVec;

      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
        VALUES ('close', ?, 'pitfall', 'Close match', 0.8, 1, ?, ?, 4, 'test-model')
      `).run(now, now, Buffer.from(closeVec.buffer));

      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
        VALUES ('far', ?, 'pitfall', 'Far match', 0.8, 1, ?, ?, 4, 'test-model')
      `).run(now, now, Buffer.from(farVec.buffer));

      const results = await service.getRelevantKnowledgeSemantic('test query', ['pitfall'], 10, 0.5);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('Close match');
      expect(results[1].content).toBe('Far match');
    });

    it('respects limit parameter', async () => {
      const embeddingService = makeMockEmbeddingService();
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingModel: 'test-model',
      });

      const now = Date.now();
      const queryVec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
      (embeddingService as { embed: (t: string) => Promise<Float32Array> }).embed = async () => queryVec;

      for (let i = 0; i < 5; i++) {
        const vec = new Float32Array([1.0 - i * 0.1, i * 0.1, 0, 0]);
        db.prepare(`
          INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
          VALUES (?, ?, 'pitfall', ?, 0.8, 1, ?, ?, 4, 'test-model')
        `).run(`k${i}`, now, `Entry ${i}`, now, Buffer.from(vec.buffer));
      }

      const results = await service.getRelevantKnowledgeSemantic('test', ['pitfall'], 2, 0.5);
      expect(results).toHaveLength(2);
    });

    it('filters by knowledge type and confidence', async () => {
      const embeddingService = makeMockEmbeddingService();
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingModel: 'test-model',
      });

      const now = Date.now();
      const vec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
      (embeddingService as { embed: (t: string) => Promise<Float32Array> }).embed = async () => vec;

      // Pitfall with high confidence
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
        VALUES ('p1', ?, 'pitfall', 'Pitfall entry', 0.8, 1, ?, ?, 4, 'test-model')
      `).run(now, now, Buffer.from(vec.buffer));

      // Pattern (different type) with high confidence
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
        VALUES ('pat1', ?, 'pattern', 'Pattern entry', 0.8, 1, ?, ?, 4, 'test-model')
      `).run(now, now, Buffer.from(vec.buffer));

      // Pitfall with low confidence
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
        VALUES ('p2', ?, 'pitfall', 'Low conf pitfall', 0.3, 1, ?, ?, 4, 'test-model')
      `).run(now, now, Buffer.from(vec.buffer));

      const results = await service.getRelevantKnowledgeSemantic('test', ['pitfall'], 10, 0.5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Pitfall entry');
    });

    it('excludes decayed entries', async () => {
      const embeddingService = makeMockEmbeddingService();
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingModel: 'test-model',
      });

      const now = Date.now();
      const vec = new Float32Array([1.0, 0.0, 0.0, 0.0]);
      (embeddingService as { embed: (t: string) => Promise<Float32Array> }).embed = async () => vec;

      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model, decayed_at)
        VALUES ('decayed', ?, 'pitfall', 'Decayed entry', 0.8, 1, ?, ?, 4, 'test-model', ?)
      `).run(now, now, Buffer.from(vec.buffer), now);

      const results = await service.getRelevantKnowledgeSemantic('test', ['pitfall'], 10, 0.5);
      // Falls back to tag-based (no non-decayed entries with embeddings), which also returns 0
      expect(results).toHaveLength(0);
    });

    it('falls back when embedding generation fails for query', async () => {
      let callCount = 0;
      const embeddingService = makeMockEmbeddingService(async () => {
        callCount++;
        throw new Error('API unavailable');
      });
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingModel: 'test-model',
      });

      // Insert a tag-based entry
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at)
        VALUES ('k1', ?, 'pitfall', 'Fallback entry', 0.8, 1, ?)
      `).run(Date.now(), Date.now());

      const results = await service.getRelevantKnowledgeSemantic('test', ['pitfall'], 10, 0.5);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Fallback entry');
      expect(callCount).toBe(1);
    });

    it('uses embedding cache when available', async () => {
      const embedCalls: string[] = [];
      const embeddingService = makeMockEmbeddingService(async (text) => {
        embedCalls.push(text);
        return new Float32Array([0.5, 0.5, 0.5, 0.5]);
      });
      const cache = makeMockCache();
      const service = new GlobalKnowledgeService(db, {
        embeddingService,
        embeddingCache: cache,
        embeddingModel: 'test-model',
      });

      const now = Date.now();
      const vec = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, embedding_model)
        VALUES ('k1', ?, 'pitfall', 'Test entry', 0.8, 1, ?, ?, 4, 'test-model')
      `).run(now, now, Buffer.from(vec.buffer));

      // First call generates and caches
      await service.getRelevantKnowledgeSemantic('query text', ['pitfall'], 10, 0.5);
      expect(embedCalls).toHaveLength(1);

      // Second call with same query text should use cache
      await service.getRelevantKnowledgeSemantic('query text', ['pitfall'], 10, 0.5);
      expect(embedCalls).toHaveLength(1); // No additional embed call
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
    expect(names).toContain('scope');
    expect(names).toContain('content');
    expect(names).toContain('confidence');
    expect(names).toContain('occurrence_count');
    expect(names).toContain('last_reinforced_at');
    expect(names).toContain('embedding');
    expect(names).toContain('embedding_dim');
    expect(names).toContain('embedding_model');
    expect(names).toContain('decayed_at');
  });

  it('enforces knowledge_type CHECK constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at)
        VALUES ('test', 1, 'invalid_type', 'test', 0.5, 1, 1)
      `).run();
    }).toThrow();
  });

  it('accepts new knowledge types from v4 schema', () => {
    const newTypes = ['constraint', 'failure_mode', 'time_estimate', 'tool_preference'];
    for (const type of newTypes) {
      expect(() => {
        db.prepare(`
          INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at)
          VALUES (?, 1, ?, 'test', 0.5, 1, 1)
        `).run(`test-${type}`, type);
      }).not.toThrow();
    }
  });

  it('schema version is 1.5.0', () => {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.value).toBe('1.5.0');
  });
});
