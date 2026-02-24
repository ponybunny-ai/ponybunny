import {
  ConversationMemoryService,
  type ICoreMemoryResult,
  type ICoreMemorySummaryService,
  type IEmbeddingService,
  type IKeywordSearchResult,
  type IMemoryRepository,
  type IVectorSearchResult,
} from '../../../src/app/conversation/memory-service.js';

class MockEmbeddingService implements IEmbeddingService {
  model = 'none';
  dimensions = 3;

  async embed(text: string): Promise<Float32Array> {
    if (text.includes('deploy')) return new Float32Array([1, 0, 0]);
    if (text.includes('test')) return new Float32Array([0, 1, 0]);
    return new Float32Array([0, 0, 1]);
  }
}

class MockSummaryService implements ICoreMemorySummaryService {
  async summarize(_input: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    ownerScope: { ownerType: 'agent' | 'user'; ownerId: string };
  }): Promise<{ summary: string; importance: number }> {
    return { summary: 'core summary', importance: 0.8 };
  }
}

class MockMemoryRepository implements IMemoryRepository {
  private cache = new Map<string, Float32Array>();
  coreUpserts: Array<{
    summary: string;
    importance: number;
    rawContent: string;
    ownerType: 'agent' | 'user';
    ownerId: string;
  }> = [];

  indexEntry(_input: {
    sessionId: string;
    turnId?: string;
    role: 'user' | 'assistant';
    content: string;
    embedding: Float32Array;
    embeddingModel: string;
    createdAt: number;
  }): void {}

  searchVector(_sessionId: string, _queryEmbedding: Float32Array, _limit: number): IVectorSearchResult[] {
    return [
      {
        entryId: 'v1',
        sessionId: 's1',
        turnId: 't1',
        role: 'user',
        content: 'deploy backend',
        createdAt: 1,
        score: 0.9,
      },
    ];
  }

  searchKeyword(_sessionId: string, _query: string, _limit: number): IKeywordSearchResult[] {
    return [
      {
        entryId: 'k1',
        sessionId: 's1',
        turnId: 't2',
        role: 'assistant',
        content: 'write tests',
        createdAt: 2,
        score: -1.5,
      },
    ];
  }

  searchCoreMemories(
    _sessionId: string,
    _ownerScope: { ownerType: 'agent' | 'user'; ownerId: string },
    _query: string,
    _limit: number
  ): ICoreMemoryResult[] {
    return [
      {
        memoryId: 'c1',
        sessionId: 's1',
        ownerType: 'agent',
        ownerId: 'pony-default',
        turnId: 't3',
        role: 'user',
        rawContent: 'hard requirement',
        summary: 'must ship before friday',
        importance: 0.95,
        createdAt: 3,
        score: 0.9,
      },
    ];
  }

  listCoreMemories(
    _sessionId: string,
    _ownerScope: { ownerType: 'agent' | 'user'; ownerId: string },
    _limit: number
  ): ICoreMemoryResult[] {
    return [];
  }

  getCachedEmbedding(cacheKey: string, _model: string): Float32Array | null {
    return this.cache.get(cacheKey) ?? null;
  }

  touchCachedEmbedding(_cacheKey: string, _model: string): void {}

  upsertCachedEmbedding(cacheKey: string, _model: string, embedding: Float32Array): void {
    this.cache.set(cacheKey, embedding);
  }

  pruneEmbeddingCache(_maxEntries: number): number {
    return 0;
  }

  upsertCoreMemory(input: {
    sessionId: string;
    ownerType: 'agent' | 'user';
    ownerId: string;
    turnId?: string;
    role: 'user' | 'assistant';
    summary: string;
    importance: number;
    rawContent: string;
    createdAt: number;
  }): void {
    this.coreUpserts.push(input);
  }
}

describe('ConversationMemoryService', () => {
  it('merges core memory and vector memory for retrieval', async () => {
    const service = new ConversationMemoryService(
      new MockMemoryRepository(),
      new MockEmbeddingService(),
      5000,
      new MockSummaryService()
    );

    const memories = await service.retrieveRelevantMemories('s1', 'deploy and test', {
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      limit: 5,
    });

    expect(memories).toHaveLength(3);
    expect(memories.some((item) => item.memoryType === 'core')).toBe(true);
    expect(memories.some((item) => item.memoryType === 'vector')).toBe(true);
  });

  it('stores core summarized memory when indexing turns', async () => {
    const repository = new MockMemoryRepository();
    const service = new ConversationMemoryService(
      repository,
      new MockEmbeddingService(),
      5000,
      new MockSummaryService()
    );

    await service.indexTurn('s1', {
      id: 't1',
      role: 'user',
      content: 'We must finish this before Friday',
      timestamp: 1,
    }, {
      ownerType: 'user',
      ownerId: 'u1',
    });

    expect(repository.coreUpserts).toHaveLength(1);
    expect(repository.coreUpserts[0].summary).toBe('core summary');
    expect(repository.coreUpserts[0].ownerType).toBe('user');
    expect(repository.coreUpserts[0].ownerId).toBe('u1');
  });
});
