import { createHash } from 'node:crypto';

import type { IConversationTurn } from '../../domain/conversation/session.js';

export type MemoryOwnerType = 'agent' | 'user';

export interface IMemoryOwnerScope {
  ownerType: MemoryOwnerType;
  ownerId: string;
}

export interface IRecalledMemory {
  entryId: string;
  sessionId: string;
  turnId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  vectorScore?: number;
  keywordScore?: number;
  score: number;
  memoryType: 'core' | 'vector';
}

export interface IVectorSearchResult {
  entryId: string;
  sessionId: string;
  turnId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  score: number;
}

export interface IKeywordSearchResult {
  entryId: string;
  sessionId: string;
  turnId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  score: number;
}

export interface ICoreMemoryResult {
  memoryId: string;
  sessionId: string;
  ownerType: MemoryOwnerType;
  ownerId: string;
  turnId?: string;
  role: 'user' | 'assistant';
  rawContent: string;
  summary: string;
  importance: number;
  createdAt: number;
  score?: number;
}

export interface IMemoryRepository {
  indexEntry(input: {
    sessionId: string;
    turnId?: string;
    role: 'user' | 'assistant';
    content: string;
    embedding: Float32Array;
    embeddingModel: string;
    createdAt: number;
  }): void;
  searchVector(sessionId: string, queryEmbedding: Float32Array, limit: number): IVectorSearchResult[];
  searchKeyword(sessionId: string, query: string, limit: number): IKeywordSearchResult[];
  getCachedEmbedding(cacheKey: string, model: string): Float32Array | null;
  touchCachedEmbedding(cacheKey: string, model: string): void;
  upsertCachedEmbedding(cacheKey: string, model: string, embedding: Float32Array): void;
  pruneEmbeddingCache(maxEntries: number): number;
  upsertCoreMemory(input: {
    sessionId: string;
    ownerType: MemoryOwnerType;
    ownerId: string;
    turnId?: string;
    role: 'user' | 'assistant';
    rawContent: string;
    summary: string;
    importance: number;
    createdAt: number;
  }): void;
  searchCoreMemories(
    sessionId: string,
    ownerScope: IMemoryOwnerScope,
    query: string,
    limit: number
  ): ICoreMemoryResult[];
  listCoreMemories(sessionId: string, ownerScope: IMemoryOwnerScope, limit: number): ICoreMemoryResult[];
}

export interface IEmbeddingService {
  model: string;
  dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

export interface ICoreMemorySummaryService {
  summarize(input: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    ownerScope: IMemoryOwnerScope;
  }): Promise<{
    summary: string;
    importance: number;
  }>;
}

export interface IConversationMemoryService {
  indexTurn(sessionId: string, turn: IConversationTurn, ownerScope: IMemoryOwnerScope): Promise<void>;
  retrieveRelevantMemories(
    sessionId: string,
    query: string,
    options?: {
      limit?: number;
      vectorWeight?: number;
      keywordWeight?: number;
      vectorLimit?: number;
      keywordLimit?: number;
      coreOwnerScopes?: IMemoryOwnerScope[];
    }
  ): Promise<IRecalledMemory[]>;
}

interface MergedMemory {
  entryId: string;
  sessionId: string;
  turnId?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  vectorScore?: number;
  keywordScore?: number;
}

export class ConversationMemoryService implements IConversationMemoryService {
  constructor(
    private repository: IMemoryRepository,
    private embeddingService: IEmbeddingService,
    private cacheMaxEntries = 5000,
    private coreSummaryService?: ICoreMemorySummaryService
  ) {}

  async indexTurn(sessionId: string, turn: IConversationTurn, ownerScope: IMemoryOwnerScope): Promise<void> {
    const content = turn.content.trim();
    if (content.length === 0) {
      return;
    }

    const embedding = await this.getOrCreateEmbedding(content);
    this.repository.indexEntry({
      sessionId,
      turnId: turn.id,
      role: turn.role,
      content,
      embedding,
      embeddingModel: this.embeddingService.model,
      createdAt: turn.timestamp,
    });

    await this.upsertCoreMemory(sessionId, turn, content, ownerScope);
  }

  async retrieveRelevantMemories(
    sessionId: string,
    query: string,
    options?: {
      limit?: number;
      vectorWeight?: number;
      keywordWeight?: number;
      vectorLimit?: number;
      keywordLimit?: number;
      coreOwnerScopes?: IMemoryOwnerScope[];
    }
  ): Promise<IRecalledMemory[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return [];
    }

    const vectorWeight = options?.vectorWeight ?? 0.65;
    const keywordWeight = options?.keywordWeight ?? 0.35;
    const weightSum = vectorWeight + keywordWeight;
    const finalVectorWeight = weightSum > 0 ? vectorWeight / weightSum : 0.5;
    const finalKeywordWeight = weightSum > 0 ? keywordWeight / weightSum : 0.5;

    const finalLimit = options?.limit ?? 8;
    const vectorLimit = Math.max(options?.vectorLimit ?? finalLimit * 3, finalLimit);
    const keywordLimit = Math.max(options?.keywordLimit ?? finalLimit * 3, finalLimit);

    const queryEmbedding = await this.getOrCreateEmbedding(normalizedQuery);
    const vectorResults = this.repository.searchVector(sessionId, queryEmbedding, vectorLimit);
    const keywordResults = this.repository.searchKeyword(sessionId, normalizedQuery, keywordLimit);
    const ownerScopes = dedupeOwnerScopes(
      options?.coreOwnerScopes && options.coreOwnerScopes.length > 0
        ? options.coreOwnerScopes
        : [{ ownerType: 'agent', ownerId: 'default-agent' }]
    );

    const coreResults = ownerScopes.flatMap((scope) =>
      this.repository.searchCoreMemories(sessionId, scope, normalizedQuery, finalLimit)
    );
    const fallbackCore = coreResults.length > 0
      ? []
      : ownerScopes.flatMap((scope) =>
        this.repository.listCoreMemories(sessionId, scope, Math.max(2, Math.floor(finalLimit / 2)))
      );

    const vectorScores = normalizeScores(
      vectorResults.map((item) => ({
        entryId: item.entryId,
        score: (item.score + 1) / 2,
      }))
    );

    const keywordScores = normalizeScores(
      keywordResults.map((item) => ({
        entryId: item.entryId,
        score: bm25ToRelevance(item.score),
      }))
    );

    const merged = new Map<string, MergedMemory>();

    for (const item of vectorResults) {
      merged.set(item.entryId, {
        entryId: item.entryId,
        sessionId: item.sessionId,
        turnId: item.turnId,
        role: item.role,
        content: item.content,
        createdAt: item.createdAt,
        vectorScore: vectorScores.get(item.entryId),
      });
    }

    for (const item of keywordResults) {
      const existing = merged.get(item.entryId);
      if (existing) {
        existing.keywordScore = keywordScores.get(item.entryId);
      } else {
        merged.set(item.entryId, {
          entryId: item.entryId,
          sessionId: item.sessionId,
          turnId: item.turnId,
          role: item.role,
          content: item.content,
          createdAt: item.createdAt,
          keywordScore: keywordScores.get(item.entryId),
        });
      }
    }

    const scored: IRecalledMemory[] = [];
    for (const item of merged.values()) {
      const vectorScore = item.vectorScore ?? 0;
      const keywordScore = item.keywordScore ?? 0;
      const score = finalVectorWeight * vectorScore + finalKeywordWeight * keywordScore;

      scored.push({
        entryId: item.entryId,
        sessionId: item.sessionId,
        turnId: item.turnId,
        role: item.role,
        content: item.content,
        createdAt: item.createdAt,
        vectorScore: item.vectorScore,
        keywordScore: item.keywordScore,
        score,
        memoryType: 'vector',
      });
    }

    for (const core of [...coreResults, ...fallbackCore]) {
      const score = Math.min(1, Math.max(0, (core.score ?? 0.5) * 0.7 + core.importance * 0.3));
      scored.push({
        entryId: core.memoryId,
        sessionId: core.sessionId,
        turnId: core.turnId,
        role: core.role,
        content: core.summary,
        createdAt: core.createdAt,
        score,
        memoryType: 'core',
      });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.createdAt - a.createdAt;
    });

    return scored.slice(0, finalLimit);
  }

  private async upsertCoreMemory(
    sessionId: string,
    turn: IConversationTurn,
    content: string,
    ownerScope: IMemoryOwnerScope
  ): Promise<void> {
    const summary = this.coreSummaryService
      ? await this.coreSummaryService.summarize({
        sessionId,
        role: turn.role,
        content,
        ownerScope,
      })
      : {
        summary: summarizeLocally(content),
        importance: estimateImportance(content),
      };

    this.repository.upsertCoreMemory({
      sessionId,
      ownerType: ownerScope.ownerType,
      ownerId: ownerScope.ownerId,
      turnId: turn.id,
      role: turn.role,
      rawContent: content,
      summary: summary.summary,
      importance: clamp(summary.importance, 0, 1),
      createdAt: turn.timestamp,
    });
  }

  private async getOrCreateEmbedding(text: string): Promise<Float32Array> {
    const normalizedText = normalizeText(text);
    const cacheKey = createHash('sha256').update(normalizedText).digest('hex');

    const cached = this.repository.getCachedEmbedding(cacheKey, this.embeddingService.model);
    if (cached) {
      this.repository.touchCachedEmbedding(cacheKey, this.embeddingService.model);
      return cached;
    }

    const embedding = await this.embeddingService.embed(normalizedText);
    this.repository.upsertCachedEmbedding(cacheKey, this.embeddingService.model, embedding);
    this.repository.pruneEmbeddingCache(this.cacheMaxEntries);
    return embedding;
  }
}

function dedupeOwnerScopes(input: IMemoryOwnerScope[]): IMemoryOwnerScope[] {
  const map = new Map<string, IMemoryOwnerScope>();
  for (const item of input) {
    const key = `${item.ownerType}:${item.ownerId}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function bm25ToRelevance(value: number): number {
  return 1 / (1 + Math.exp(value));
}

function normalizeScores(input: Array<{ entryId: string; score: number }>): Map<string, number> {
  const output = new Map<string, number>();
  if (input.length === 0) {
    return output;
  }

  let minScore = Number.POSITIVE_INFINITY;
  let maxScore = Number.NEGATIVE_INFINITY;

  for (const item of input) {
    if (item.score < minScore) {
      minScore = item.score;
    }
    if (item.score > maxScore) {
      maxScore = item.score;
    }
  }

  const range = maxScore - minScore;
  if (range <= Number.EPSILON) {
    for (const item of input) {
      output.set(item.entryId, 1);
    }
    return output;
  }

  for (const item of input) {
    output.set(item.entryId, (item.score - minScore) / range);
  }

  return output;
}

function summarizeLocally(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

function estimateImportance(value: string): number {
  const normalized = value.toLowerCase();
  let score = 0.4;
  if (/must|important|critical|deadline|urgent|需要|必须|关键/.test(normalized)) {
    score += 0.3;
  }
  if (value.length > 200) {
    score += 0.2;
  }
  return clamp(score, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
