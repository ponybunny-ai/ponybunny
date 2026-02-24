import Database from 'better-sqlite3';

import { SqliteMemoryRepository } from '../../../src/infra/persistence/sqlite-memory-repository.js';

describe('SqliteMemoryRepository', () => {
  let db: Database.Database;
  let repository: SqliteMemoryRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repository = new SqliteMemoryRepository(db);
    repository.initialize();
  });

  afterEach(() => {
    db.close();
  });

  it('indexes entries and returns cosine-ranked vector matches', () => {
    repository.indexEntry({
      sessionId: 's1',
      turnId: 't1',
      role: 'user',
      content: 'build api service',
      embedding: new Float32Array([1, 0, 0]),
      embeddingModel: 'none',
      createdAt: Date.now(),
    });

    repository.indexEntry({
      sessionId: 's1',
      turnId: 't2',
      role: 'assistant',
      content: 'weather forecast',
      embedding: new Float32Array([0, 1, 0]),
      embeddingModel: 'none',
      createdAt: Date.now() + 1,
    });

    const results = repository.searchVector('s1', new Float32Array([1, 0, 0]), 2);
    expect(results).toHaveLength(2);
    expect(results[0].turnId).toBe('t1');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('returns BM25-ranked keyword matches using FTS5', () => {
    repository.indexEntry({
      sessionId: 's1',
      turnId: 't1',
      role: 'user',
      content: 'deploy production pipeline',
      embedding: new Float32Array([1, 0]),
      embeddingModel: 'none',
      createdAt: Date.now(),
    });

    repository.indexEntry({
      sessionId: 's1',
      turnId: 't2',
      role: 'assistant',
      content: 'write unit tests',
      embedding: new Float32Array([0, 1]),
      embeddingModel: 'none',
      createdAt: Date.now() + 1,
    });

    const results = repository.searchKeyword('s1', 'deploy pipeline', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].turnId).toBe('t1');
  });

  it('supports embedding cache and LRU eviction', () => {
    repository.upsertCachedEmbedding('k1', 'none', new Float32Array([1, 1]));
    repository.upsertCachedEmbedding('k2', 'none', new Float32Array([2, 2]));
    repository.upsertCachedEmbedding('k3', 'none', new Float32Array([3, 3]));

    repository.touchCachedEmbedding('k3', 'none');

    const pruned = repository.pruneEmbeddingCache(2);
    expect(pruned).toBe(1);

    const k1 = repository.getCachedEmbedding('k1', 'none');
    const k2 = repository.getCachedEmbedding('k2', 'none');
    const k3 = repository.getCachedEmbedding('k3', 'none');

    expect(k3).not.toBeNull();
    expect((k1 === null) || (k2 === null)).toBe(true);
  });

  it('stores and retrieves core summarized memories', () => {
    repository.upsertCoreMemory({
      sessionId: 's1',
      ownerType: 'agent',
      ownerId: 'pony-default',
      turnId: 't-core-1',
      role: 'user',
      rawContent: 'We must deliver before Friday and include API docs',
      summary: 'Delivery before Friday with API docs requirement',
      importance: 0.9,
      createdAt: Date.now(),
    });

    repository.upsertCoreMemory({
      sessionId: 's1',
      ownerType: 'user',
      ownerId: 'user-1',
      turnId: 't-core-2',
      role: 'assistant',
      rawContent: 'I will prioritize docs and release checklist',
      summary: 'Prioritize docs and release checklist',
      importance: 0.7,
      createdAt: Date.now() + 1,
    });

    const searched = repository.searchCoreMemories(
      's1',
      { ownerType: 'agent', ownerId: 'pony-default' },
      'friday docs',
      5
    );
    expect(searched.length).toBeGreaterThan(0);
    expect(searched[0].summary.toLowerCase()).toContain('friday');
    expect(searched[0].ownerType).toBe('agent');

    const listedAgent = repository.listCoreMemories(
      's1',
      { ownerType: 'agent', ownerId: 'pony-default' },
      5
    );
    const listedUser = repository.listCoreMemories(
      's1',
      { ownerType: 'user', ownerId: 'user-1' },
      5
    );

    expect(listedAgent).toHaveLength(1);
    expect(listedUser).toHaveLength(1);
    expect(listedAgent[0].ownerId).toBe('pony-default');
    expect(listedUser[0].ownerId).toBe('user-1');
  });
});
