import { Account, HealthScoreState, TokenBucketState } from './account-types.js';

const HEALTH_SCORE_SUCCESS = 1;
const HEALTH_SCORE_RATE_LIMIT = -10;
const HEALTH_SCORE_FAILURE = -20;
const HEALTH_SCORE_MAX = 1000;
const HEALTH_SCORE_MIN = -1000;
const HEALTH_SCORE_DECAY_MS = 5 * 60 * 1000;

const TOKEN_BUCKET_MAX = 50;
const TOKEN_BUCKET_REFILL_RATE = 6;
const TOKEN_BUCKET_REFILL_INTERVAL_MS = 60 * 1000;

export class HealthScoreTracker {
  private scores: Map<string, HealthScoreState> = new Map();

  initialize(accountId: string, score: number = 0): void {
    if (!this.scores.has(accountId)) {
      this.scores.set(accountId, {
        score,
        consecutiveFailures: 0,
      });
    }
  }

  recordSuccess(accountId: string): void {
    const state = this.getOrCreate(accountId);
    state.score = Math.min(HEALTH_SCORE_MAX, state.score + HEALTH_SCORE_SUCCESS);
    state.consecutiveFailures = 0;
    delete state.lastFailureTime;
  }

  recordRateLimit(accountId: string): void {
    const state = this.getOrCreate(accountId);
    state.score = Math.max(HEALTH_SCORE_MIN, state.score + HEALTH_SCORE_RATE_LIMIT);
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();
  }

  recordFailure(accountId: string): void {
    const state = this.getOrCreate(accountId);
    state.score = Math.max(HEALTH_SCORE_MIN, state.score + HEALTH_SCORE_FAILURE);
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();
  }

  getScore(accountId: string): number {
    const state = this.scores.get(accountId);
    if (!state) return 0;

    if (state.lastFailureTime) {
      const timeSinceFailure = Date.now() - state.lastFailureTime;
      if (timeSinceFailure > HEALTH_SCORE_DECAY_MS) {
        const decay = Math.floor(timeSinceFailure / HEALTH_SCORE_DECAY_MS);
        state.score = Math.min(HEALTH_SCORE_MAX, state.score + decay * 10);
      }
    }

    return state.score;
  }

  getConsecutiveFailures(accountId: string): number {
    return this.scores.get(accountId)?.consecutiveFailures || 0;
  }

  reset(accountId: string): void {
    this.scores.set(accountId, {
      score: 0,
      consecutiveFailures: 0,
    });
  }

  private getOrCreate(accountId: string): HealthScoreState {
    if (!this.scores.has(accountId)) {
      this.scores.set(accountId, {
        score: 0,
        consecutiveFailures: 0,
      });
    }
    return this.scores.get(accountId)!;
  }
}

export class TokenBucketTracker {
  private buckets: Map<string, TokenBucketState> = new Map();

  initialize(accountId: string, tokens: number = TOKEN_BUCKET_MAX): void {
    if (!this.buckets.has(accountId)) {
      this.buckets.set(accountId, {
        tokens,
        lastRefill: Date.now(),
      });
    }
  }

  hasTokens(accountId: string, required: number = 1): boolean {
    this.refillIfNeeded(accountId);
    const bucket = this.buckets.get(accountId);
    return bucket ? bucket.tokens >= required : false;
  }

  consumeTokens(accountId: string, count: number = 1): boolean {
    this.refillIfNeeded(accountId);
    const bucket = this.getOrCreate(accountId);
    
    if (bucket.tokens >= count) {
      bucket.tokens -= count;
      return true;
    }
    return false;
  }

  getTokens(accountId: string): number {
    this.refillIfNeeded(accountId);
    return this.buckets.get(accountId)?.tokens || 0;
  }

  reset(accountId: string): void {
    this.buckets.set(accountId, {
      tokens: TOKEN_BUCKET_MAX,
      lastRefill: Date.now(),
    });
  }

  private refillIfNeeded(accountId: string): void {
    const bucket = this.getOrCreate(accountId);
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const intervals = Math.floor(elapsed / TOKEN_BUCKET_REFILL_INTERVAL_MS);

    if (intervals > 0) {
      const tokensToAdd = intervals * TOKEN_BUCKET_REFILL_RATE;
      bucket.tokens = Math.min(TOKEN_BUCKET_MAX, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }

  private getOrCreate(accountId: string): TokenBucketState {
    if (!this.buckets.has(accountId)) {
      this.buckets.set(accountId, {
        tokens: TOKEN_BUCKET_MAX,
        lastRefill: Date.now(),
      });
    }
    return this.buckets.get(accountId)!;
  }
}

export function generateJitter(baseMs: number): number {
  const jitterRange = baseMs * 0.33;
  return Math.floor(Math.random() * jitterRange * 2 - jitterRange);
}

export function calculateBackoffMs(reason: string, failures: number): number {
  const QUOTA_EXHAUSTED_BACKOFFS = [
    60 * 1000,
    5 * 60 * 1000,
    30 * 60 * 1000,
    2 * 60 * 60 * 1000,
  ];

  switch (reason) {
    case 'QUOTA_EXHAUSTED':
      const index = Math.min(failures, QUOTA_EXHAUSTED_BACKOFFS.length - 1);
      return QUOTA_EXHAUSTED_BACKOFFS[index];
    case 'RATE_LIMIT_EXCEEDED':
      return 30 * 1000;
    case 'MODEL_CAPACITY_EXHAUSTED':
      return 45 * 1000 + generateJitter(30 * 1000);
    case 'SERVICE_UNAVAILABLE':
      return 60 * 1000 + generateJitter(30 * 1000);
    default:
      return 60 * 1000;
  }
}
