import { EmbeddingLruCache } from '../../../src/infra/persistence/embedding-lru-cache.js';

function makeEmbedding(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('EmbeddingLruCache', () => {
  let sqliteGet: jest.Mock<Float32Array | null, [string, string]>;
  let sqliteSet: jest.Mock<void, [string, string, Float32Array]>;

  function createCache(maxEntries = 500) {
    return new EmbeddingLruCache({
      maxEntries,
      sqliteGet,
      sqliteSet,
    });
  }

  beforeEach(() => {
    sqliteGet = jest.fn().mockReturnValue(null);
    sqliteSet = jest.fn();
  });

  // -----------------------------------------------------------------
  // Basic behaviour
  // -----------------------------------------------------------------

  it('returns null for unknown keys', () => {
    const cache = createCache();
    expect(cache.get('unknown', 'text-embedding-3-small')).toBeNull();
  });

  it('returns the embedding after set()', () => {
    const cache = createCache();
    const emb = makeEmbedding(1, 2, 3);
    cache.set('hello', 'model-a', emb);
    const result = cache.get('hello', 'model-a');
    expect(result).toEqual(emb);
  });

  // -----------------------------------------------------------------
  // Memory vs SQLite interaction
  // -----------------------------------------------------------------

  it('does NOT call sqliteGet on a memory cache hit', () => {
    const cache = createCache();
    cache.set('hello', 'model-a', makeEmbedding(1));

    cache.get('hello', 'model-a');

    expect(sqliteGet).not.toHaveBeenCalled();
  });

  it('falls through to sqliteGet on a memory cache miss', () => {
    const cache = createCache();
    cache.get('miss', 'model-a');
    expect(sqliteGet).toHaveBeenCalledWith('miss', 'model-a');
  });

  it('promotes a SQLite hit into the memory cache', () => {
    const emb = makeEmbedding(4, 5, 6);
    sqliteGet.mockReturnValueOnce(emb);

    const cache = createCache();

    // First call: miss in memory, hit in SQLite
    const first = cache.get('key1', 'model-a');
    expect(first).toEqual(emb);
    expect(sqliteGet).toHaveBeenCalledTimes(1);

    // Second call: should come from memory — no second SQLite call
    const second = cache.get('key1', 'model-a');
    expect(second).toEqual(emb);
    expect(sqliteGet).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------
  // set() persistence
  // -----------------------------------------------------------------

  it('writes to both memory and SQLite on set()', () => {
    const cache = createCache();
    const emb = makeEmbedding(7, 8);
    cache.set('k', 'm', emb);

    // Memory
    expect(cache.get('k', 'm')).toEqual(emb);
    // SQLite
    expect(sqliteSet).toHaveBeenCalledWith('k', 'm', emb);
  });

  it('swallows SQLite write errors without affecting memory', () => {
    sqliteSet.mockImplementation(() => {
      throw new Error('disk full');
    });

    const cache = createCache();
    const emb = makeEmbedding(9);
    // Should not throw
    cache.set('k', 'm', emb);
    expect(cache.get('k', 'm')).toEqual(emb);
  });

  // -----------------------------------------------------------------
  // Composite cache key (key + model)
  // -----------------------------------------------------------------

  it('treats the same key with different models as separate entries', () => {
    const cache = createCache();
    const embA = makeEmbedding(1);
    const embB = makeEmbedding(2);

    cache.set('shared-key', 'model-a', embA);
    cache.set('shared-key', 'model-b', embB);

    expect(cache.get('shared-key', 'model-a')).toEqual(embA);
    expect(cache.get('shared-key', 'model-b')).toEqual(embB);
  });

  // -----------------------------------------------------------------
  // LRU eviction
  // -----------------------------------------------------------------

  it('evicts the least recently used entry when exceeding maxEntries', () => {
    const cache = createCache(3);

    cache.set('a', 'm', makeEmbedding(1));
    cache.set('b', 'm', makeEmbedding(2));
    cache.set('c', 'm', makeEmbedding(3));

    // All three should be present
    expect(cache.size).toBe(3);

    // Adding a fourth should evict 'a' (oldest)
    cache.set('d', 'm', makeEmbedding(4));
    expect(cache.size).toBe(3);
    expect(cache.get('a', 'm')).toBeNull(); // evicted
    expect(cache.get('b', 'm')).toEqual(makeEmbedding(2));
    expect(cache.get('d', 'm')).toEqual(makeEmbedding(4));
  });

  it('accessing an entry makes it most-recently-used (not evicted next)', () => {
    const cache = createCache(3);

    cache.set('a', 'm', makeEmbedding(1));
    cache.set('b', 'm', makeEmbedding(2));
    cache.set('c', 'm', makeEmbedding(3));

    // Touch 'a' so it moves to MRU position
    cache.get('a', 'm');

    // Insert 'd' — should evict 'b' (now the LRU), not 'a'
    cache.set('d', 'm', makeEmbedding(4));
    expect(cache.get('b', 'm')).toBeNull(); // evicted
    expect(cache.get('a', 'm')).toEqual(makeEmbedding(1)); // still present
  });

  it('evicts entries promoted from SQLite when over capacity', () => {
    const cache = createCache(2);

    cache.set('a', 'm', makeEmbedding(1));
    cache.set('b', 'm', makeEmbedding(2));

    // Simulate a SQLite hit that gets promoted — should evict 'a'
    sqliteGet.mockReturnValueOnce(makeEmbedding(3));
    cache.get('c', 'm');

    expect(cache.size).toBe(2);
    expect(cache.get('a', 'm')).toBeNull(); // evicted
    expect(cache.get('b', 'm')).toEqual(makeEmbedding(2));
  });
});
