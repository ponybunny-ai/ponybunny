import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { KnowledgeDecayService } from '../../../src/app/knowledge/knowledge-decay-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function insertKnowledge(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    knowledge_type: string;
    content: string;
    confidence: number;
    occurrence_count: number;
    last_reinforced_at: number;
    embedding: Buffer | null;
    decayed_at: number | null;
  }> = {},
): string {
  const id = overrides.id ?? `k-${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO global_knowledge
      (id, created_at, knowledge_type, content, confidence, occurrence_count, last_reinforced_at, embedding, embedding_dim, decayed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    now,
    overrides.knowledge_type ?? 'pitfall',
    overrides.content ?? `Knowledge entry ${id}`,
    overrides.confidence ?? 0.5,
    overrides.occurrence_count ?? 1,
    overrides.last_reinforced_at ?? now,
    overrides.embedding ?? null,
    overrides.embedding ? overrides.embedding.byteLength / 4 : null,
    overrides.decayed_at ?? null,
  );
  return id;
}

/**
 * Create a normalized Float32Array embedding from a seed vector, then wrap in Buffer.
 */
function makeEmbedding(values: number[]): Buffer {
  // Normalize to unit length for cosine similarity to work predictably
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  const normalized = values.map((v) => (norm === 0 ? 0 : v / norm));
  const arr = new Float32Array(normalized);
  return Buffer.from(arr.buffer);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KnowledgeDecayService', () => {
  let db: Database.Database;
  let service: KnowledgeDecayService;

  beforeEach(() => {
    db = createDb();
    service = new KnowledgeDecayService(db);
  });

  afterEach(() => {
    db.close();
  });

  // -----------------------------------------------------------------------
  // applyAgeDecay
  // -----------------------------------------------------------------------

  describe('applyAgeDecay', () => {
    it('reduces confidence on entries older than 90 days with low occurrence', () => {
      const oldTime = Date.now() - 100 * DAY_MS;
      const id = insertKnowledge(db, {
        confidence: 0.5,
        occurrence_count: 1,
        last_reinforced_at: oldTime,
      });

      const result = service.applyAgeDecay();
      expect(result.confidenceReduced).toBe(1);

      const row = db.prepare('SELECT confidence FROM global_knowledge WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBeCloseTo(0.35, 5);
    });

    it('soft-deletes entries that fall below 0.1 confidence', () => {
      const oldTime = Date.now() - 100 * DAY_MS;
      const id = insertKnowledge(db, {
        confidence: 0.08,
        occurrence_count: 1,
        last_reinforced_at: oldTime,
      });

      const result = service.applyAgeDecay();
      // confidence 0.08 - 0.15 = 0 (clamped), which is < 0.1
      expect(result.decayed).toBeGreaterThanOrEqual(1);

      const row = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get(id) as { decayed_at: number | null };
      expect(row.decayed_at).not.toBeNull();
    });

    it('does not affect entries reinforced recently (within 90 days)', () => {
      const recentTime = Date.now() - 30 * DAY_MS;
      const id = insertKnowledge(db, {
        confidence: 0.5,
        occurrence_count: 1,
        last_reinforced_at: recentTime,
      });

      const result = service.applyAgeDecay();
      expect(result.confidenceReduced).toBe(0);

      const row = db.prepare('SELECT confidence, decayed_at FROM global_knowledge WHERE id = ?').get(id) as {
        confidence: number;
        decayed_at: number | null;
      };
      expect(row.confidence).toBe(0.5);
      expect(row.decayed_at).toBeNull();
    });

    it('does not affect entries with occurrence_count >= 3', () => {
      const oldTime = Date.now() - 100 * DAY_MS;
      const id = insertKnowledge(db, {
        confidence: 0.5,
        occurrence_count: 3,
        last_reinforced_at: oldTime,
      });

      const result = service.applyAgeDecay();
      expect(result.confidenceReduced).toBe(0);

      const row = db.prepare('SELECT confidence FROM global_knowledge WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBe(0.5);
    });

    it('does not touch already-decayed entries', () => {
      const oldTime = Date.now() - 100 * DAY_MS;
      insertKnowledge(db, {
        confidence: 0.5,
        occurrence_count: 1,
        last_reinforced_at: oldTime,
        decayed_at: oldTime,
      });

      const result = service.applyAgeDecay();
      expect(result.confidenceReduced).toBe(0);
    });

    it('clamps confidence at 0 (never goes negative)', () => {
      const oldTime = Date.now() - 100 * DAY_MS;
      const id = insertKnowledge(db, {
        confidence: 0.05,
        occurrence_count: 1,
        last_reinforced_at: oldTime,
      });

      service.applyAgeDecay();

      const row = db.prepare('SELECT confidence FROM global_knowledge WHERE id = ?').get(id) as { confidence: number };
      expect(row.confidence).toBe(0); // MAX(0, 0.05 - 0.15) = 0
    });
  });

  // -----------------------------------------------------------------------
  // deduplicateSemantically
  // -----------------------------------------------------------------------

  describe('deduplicateSemantically', () => {
    it('removes near-duplicate entries with identical embeddings', () => {
      const emb = makeEmbedding([1, 0, 0, 0]);

      insertKnowledge(db, {
        id: 'strong',
        knowledge_type: 'pitfall',
        confidence: 0.8,
        occurrence_count: 5,
        embedding: emb,
      });
      insertKnowledge(db, {
        id: 'weak',
        knowledge_type: 'pitfall',
        confidence: 0.3,
        occurrence_count: 1,
        embedding: emb,
      });

      const result = service.deduplicateSemantically();
      expect(result.merged).toBe(1);

      const strong = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get('strong') as { decayed_at: number | null };
      const weak = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get('weak') as { decayed_at: number | null };
      expect(strong.decayed_at).toBeNull();
      expect(weak.decayed_at).not.toBeNull();
    });

    it('keeps the higher-confidence entry', () => {
      const emb = makeEmbedding([0, 1, 0, 0]);

      insertKnowledge(db, {
        id: 'high-conf',
        knowledge_type: 'pattern',
        confidence: 0.9,
        occurrence_count: 1,
        embedding: emb,
      });
      insertKnowledge(db, {
        id: 'low-conf',
        knowledge_type: 'pattern',
        confidence: 0.2,
        occurrence_count: 10,
        embedding: emb,
      });

      service.deduplicateSemantically();

      const highConf = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get('high-conf') as { decayed_at: number | null };
      const lowConf = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get('low-conf') as { decayed_at: number | null };
      expect(highConf.decayed_at).toBeNull();
      expect(lowConf.decayed_at).not.toBeNull();
    });

    it('does not merge entries of different knowledge_type', () => {
      const emb = makeEmbedding([0, 0, 1, 0]);

      insertKnowledge(db, {
        id: 'pitfall-entry',
        knowledge_type: 'pitfall',
        confidence: 0.5,
        embedding: emb,
      });
      insertKnowledge(db, {
        id: 'pattern-entry',
        knowledge_type: 'pattern',
        confidence: 0.5,
        embedding: emb,
      });

      const result = service.deduplicateSemantically();
      expect(result.merged).toBe(0);

      const pitfall = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get('pitfall-entry') as { decayed_at: number | null };
      const pattern = db.prepare('SELECT decayed_at FROM global_knowledge WHERE id = ?').get('pattern-entry') as { decayed_at: number | null };
      expect(pitfall.decayed_at).toBeNull();
      expect(pattern.decayed_at).toBeNull();
    });

    it('does not merge entries with low similarity (orthogonal embeddings)', () => {
      const embA = makeEmbedding([1, 0, 0, 0]);
      const embB = makeEmbedding([0, 1, 0, 0]);

      insertKnowledge(db, {
        id: 'entry-a',
        knowledge_type: 'pitfall',
        confidence: 0.5,
        embedding: embA,
      });
      insertKnowledge(db, {
        id: 'entry-b',
        knowledge_type: 'pitfall',
        confidence: 0.5,
        embedding: embB,
      });

      const result = service.deduplicateSemantically();
      expect(result.merged).toBe(0);
    });

    it('skips entries without embeddings', () => {
      insertKnowledge(db, {
        id: 'no-emb-1',
        knowledge_type: 'pitfall',
        confidence: 0.5,
        embedding: null,
      });
      insertKnowledge(db, {
        id: 'no-emb-2',
        knowledge_type: 'pitfall',
        confidence: 0.5,
        embedding: null,
      });

      const result = service.deduplicateSemantically();
      expect(result.merged).toBe(0);
    });

    it('returns merged count of 0 when no entries exist', () => {
      const result = service.deduplicateSemantically();
      expect(result.merged).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getActiveEntryCount
  // -----------------------------------------------------------------------

  describe('getActiveEntryCount', () => {
    it('returns correct count of active entries', () => {
      insertKnowledge(db, { id: 'active-1' });
      insertKnowledge(db, { id: 'active-2' });
      insertKnowledge(db, { id: 'decayed-1', decayed_at: Date.now() });

      expect(service.getActiveEntryCount()).toBe(2);
    });

    it('returns 0 when no entries exist', () => {
      expect(service.getActiveEntryCount()).toBe(0);
    });
  });
});
