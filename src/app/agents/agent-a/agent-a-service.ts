import * as crypto from 'crypto';
import type {
  AgentATickInput,
  AgentATickResult,
  AgentASourceConfig,
  AgentACheckpoint,
  AgentARawItem,
  AgentAPlatform,
} from './types.js';
import { DEFAULT_AGENT_A_CONFIG } from './limits.js';
import { AgentAStorage } from './storage.js';
import { AgentASourceReader } from './source-reader.js';
import { AgentALLMHelper } from './llm-helpers.js';
import type { LLMService } from '../../../infra/llm/llm-service.js';

export interface AgentAStorageLike {
  ensureSchema(): Promise<void>;
  recordRunStart(runId: string): Promise<void>;
  recordRunFinish(
    runId: string,
    metrics: { sourcesProcessed: number; itemsFetched: number; itemsScanned: number; itemsStored: number; errors: number }
  ): Promise<void>;
  listSources(limit: number): Promise<AgentASourceConfig[]>;
  getCheckpoint(platform: string, sourceId: string): Promise<AgentACheckpoint | null>;
  upsertCheckpoint(checkpoint: AgentACheckpoint): Promise<void>;
  storeRecord(request: {
    platform: AgentAPlatform;
    source_id: string;
    permalink: string;
    author: string | null;
    created_at: string | null;
    problem_raw_text: string;
    surrounding_context: string;
    label: string;
    signal_markers: string[];
    role_guess: string;
    role_confidence: number;
    raw_text_hash: string;
    ingest_run_id: string;
  }): Promise<{ stored: boolean; record_id: string | null; deduped: boolean }>;
}

export interface AgentASourceReaderLike {
  readStream(request: {
    platform: AgentAPlatform;
    source_id: string;
    cursor: string | null;
    time_window: string;
    max_items: number;
  }): Promise<{ items: AgentARawItem[]; next_cursor: string | null; error?: string }>;
}

export interface AgentALLMHelperLike {
  detectProblemSignal(request: { raw_text: string; platform: AgentAPlatform }): Promise<{ has_problem_signal: boolean; signal_markers: string[]; label: string; confidence: number }>;
  extractProblemBlock(request: { raw_text: string; window_chars: number; platform: AgentAPlatform }): Promise<{ problem_raw_text: string; surrounding_context: string }>;
  guessAuthorRole(rawText: string): Promise<{ role_guess: string; confidence: number }>;
}

interface AgentAServiceDeps {
  storage: AgentAStorageLike;
  sourceReader: AgentASourceReaderLike;
  llmHelper: AgentALLMHelperLike;
  now?: () => Date;
}

class RateLimiter {
  private platformHits = new Map<AgentAPlatform, number[]>();

  canProceed(platform: AgentAPlatform, maxRequestsPerMinute: number, nowMs: number): boolean {
    const windowStart = nowMs - 60_000;
    const hits = (this.platformHits.get(platform) || []).filter(ts => ts >= windowStart);
    this.platformHits.set(platform, hits);
    return hits.length < maxRequestsPerMinute;
  }

  record(platform: AgentAPlatform, nowMs: number): void {
    const hits = this.platformHits.get(platform) || [];
    hits.push(nowMs);
    this.platformHits.set(platform, hits);
  }
}

export class AgentAService {
  private config = DEFAULT_AGENT_A_CONFIG;
  private rateLimiter = new RateLimiter();
  private nowFn: () => Date;

  constructor(private deps: AgentAServiceDeps) {
    this.nowFn = deps.now ?? (() => new Date());
  }

  static create(llmService: LLMService): AgentAService {
    const storage = new AgentAStorage();
    const sourceReader = new AgentASourceReader(undefined, DEFAULT_AGENT_A_CONFIG.limits);
    const llmHelper = new AgentALLMHelper(llmService, DEFAULT_AGENT_A_CONFIG.limits);
    return new AgentAService({ storage, sourceReader, llmHelper });
  }

  async tick(input: AgentATickInput): Promise<AgentATickResult> {
    const startTime = Date.now();
    await this.deps.storage.ensureSchema();
    await this.deps.storage.recordRunStart(input.run_id);

    let sourcesProcessed = 0;
    let itemsFetched = 0;
    let itemsScanned = 0;
    let itemsStored = 0;
    let errors = 0;

    const sources = await this.deps.storage.listSources(input.max_sources_per_tick);

    for (const source of sources) {
      if (sourcesProcessed >= input.max_sources_per_tick) break;

      try {
        const checkpoint = await this.deps.storage.getCheckpoint(source.platform, source.source_id);
        const shouldSkip = this.shouldSkipSource(source, checkpoint);
        if (shouldSkip) continue;

        const timeWindow = input.default_time_window;
        const maxItems = Math.min(input.max_items_per_source, source.max_items);
        const readResult = await this.deps.sourceReader.readStream({
          platform: source.platform,
          source_id: source.source_id,
          cursor: checkpoint?.cursor ?? null,
          time_window: timeWindow,
          max_items: maxItems,
        });

        if (readResult.error) {
          errors += 1;
          await this.handleSourceFailure(source, checkpoint, readResult.error);
          continue;
        }

        sourcesProcessed += 1;
        itemsFetched += readResult.items.length;

        const processed = await this.processItems(source, readResult.items, input.run_id);
        itemsScanned += processed.itemsScanned;
        itemsStored += processed.itemsStored;

        await this.handleSourceSuccess(source, checkpoint, readResult);
      } catch (error) {
        errors += 1;
        await this.handleSourceFailure(source, await this.deps.storage.getCheckpoint(source.platform, source.source_id), String(error));
      }
    }

    const durationMs = Date.now() - startTime;
    await this.deps.storage.recordRunFinish(input.run_id, {
      sourcesProcessed,
      itemsFetched,
      itemsScanned,
      itemsStored,
      errors,
    });

    return {
      run_id: input.run_id,
      sources_processed: sourcesProcessed,
      items_fetched: itemsFetched,
      items_scanned: itemsScanned,
      items_stored: itemsStored,
      errors,
      duration_ms: durationMs,
    };
  }

  private shouldSkipSource(source: AgentASourceConfig, checkpoint: AgentACheckpoint | null): boolean {
    const now = this.nowFn().getTime();
    if (checkpoint?.updated_at) {
      const updatedAt = new Date(checkpoint.updated_at).getTime();
      const pollIntervalMs = source.poll_interval_seconds * 1000;
      if (Number.isFinite(updatedAt) && pollIntervalMs > 0 && now - updatedAt < pollIntervalMs) {
        return true;
      }
    }
    if (checkpoint?.backoff_until) {
      const backoffUntil = new Date(checkpoint.backoff_until).getTime();
      if (backoffUntil > now) {
        return true;
      }
    }

    const rateLimit = this.config.rate_limits[source.platform];
    if (!this.rateLimiter.canProceed(source.platform, rateLimit.max_requests_per_minute, now)) {
      return true;
    }

    return false;
  }

  private async processItems(
    source: AgentASourceConfig,
    items: AgentARawItem[],
    runId: string
  ): Promise<{ itemsScanned: number; itemsStored: number }> {
    let itemsScanned = 0;
    let itemsStored = 0;

    for (const item of items) {
      itemsScanned += 1;
      const detect = await this.deps.llmHelper.detectProblemSignal({
        raw_text: item.raw_text,
        platform: item.platform,
      });

      if (!detect.has_problem_signal) {
        continue;
      }

      const extract = await this.deps.llmHelper.extractProblemBlock({
        raw_text: item.raw_text,
        window_chars: 300,
        platform: item.platform,
      });

      const role = await this.deps.llmHelper.guessAuthorRole(item.raw_text);

      const rawTextHash = this.hashText(item.raw_text);

      const storeResult = await this.deps.storage.storeRecord({
        platform: item.platform,
        source_id: item.source_id,
        permalink: item.permalink,
        author: item.author,
        created_at: item.created_at,
        problem_raw_text: extract.problem_raw_text.slice(0, this.config.limits.problem_raw_text_max_chars),
        surrounding_context: extract.surrounding_context.slice(0, this.config.limits.surrounding_context_max_chars),
        label: detect.label,
        signal_markers: detect.signal_markers,
        role_guess: role.role_guess,
        role_confidence: role.confidence,
        raw_text_hash: rawTextHash,
        ingest_run_id: runId,
      });

      if (storeResult.stored) {
        itemsStored += 1;
      }
    }

    return { itemsScanned, itemsStored };
  }

  private async handleSourceSuccess(
    source: AgentASourceConfig,
    checkpoint: AgentACheckpoint | null,
    readResult: { items: AgentARawItem[]; next_cursor: string | null }
  ): Promise<void> {
    const lastItemTime = readResult.items
      .map(item => item.created_at)
      .filter(Boolean)
      .sort()
      .pop();

    const updated: AgentACheckpoint = {
      platform: source.platform,
      source_id: source.source_id,
      cursor: readResult.next_cursor ?? checkpoint?.cursor ?? null,
      last_seen_at: lastItemTime ?? checkpoint?.last_seen_at ?? this.nowFn().toISOString(),
      backoff_until: null,
      failure_count: 0,
      updated_at: this.nowFn().toISOString(),
    };

    this.rateLimiter.record(source.platform, this.nowFn().getTime());
    await this.deps.storage.upsertCheckpoint(updated);
  }

  private async handleSourceFailure(
    source: AgentASourceConfig,
    checkpoint: AgentACheckpoint | null,
    error: string
  ): Promise<void> {
    const failureCount = (checkpoint?.failure_count ?? 0) + 1;
    const { backoffUntil, resetFailureCount } = this.calculateBackoff(source.platform, failureCount, error);

    const updated: AgentACheckpoint = {
      platform: source.platform,
      source_id: source.source_id,
      cursor: checkpoint?.cursor ?? null,
      last_seen_at: checkpoint?.last_seen_at ?? null,
      backoff_until: backoffUntil,
      failure_count: resetFailureCount ? 0 : failureCount,
      updated_at: this.nowFn().toISOString(),
    };

    await this.deps.storage.upsertCheckpoint(updated);
  }

  private calculateBackoff(platform: AgentAPlatform, failureCount: number, error: string): {
    backoffUntil: string | null;
    resetFailureCount: boolean;
  } {
    const now = this.nowFn().getTime();
    const rateLimit = this.config.rate_limits[platform];
    const normalized = error.toLowerCase();

    if (failureCount >= this.config.circuit_breaker_failure_threshold) {
      const backoffMs = this.config.circuit_breaker_backoff_hours * 60 * 60 * 1000;
      return { backoffUntil: new Date(now + backoffMs).toISOString(), resetFailureCount: true };
    }

    let backoffSeconds: number | undefined;
    if (normalized.includes('429') && rateLimit.backoff_on_429_seconds) {
      backoffSeconds = rateLimit.backoff_on_429_seconds[Math.min(failureCount - 1, rateLimit.backoff_on_429_seconds.length - 1)];
    }
    if (normalized.includes('403') && rateLimit.backoff_on_403_seconds) {
      backoffSeconds = rateLimit.backoff_on_403_seconds[Math.min(failureCount - 1, rateLimit.backoff_on_403_seconds.length - 1)];
    }
    if ((normalized.includes('403') || normalized.includes('429')) && rateLimit.backoff_on_403_429_seconds) {
      backoffSeconds = rateLimit.backoff_on_403_429_seconds[Math.min(failureCount - 1, rateLimit.backoff_on_403_429_seconds.length - 1)];
    }

    if (!backoffSeconds) {
      return { backoffUntil: null, resetFailureCount: false };
    }

    return { backoffUntil: new Date(now + backoffSeconds * 1000).toISOString(), resetFailureCount: false };
  }

  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
