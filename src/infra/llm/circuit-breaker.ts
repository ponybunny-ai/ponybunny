/**
 * Circuit Breaker for LLM provider endpoints.
 *
 * Prevents wasted latency by short-circuiting requests to endpoints
 * that are known to be down. After consecutive failures exceed a
 * threshold, the breaker opens and rejects requests immediately
 * until a cooldown period passes.
 *
 * State machine:
 *   closed  →(failures >= threshold)→  open
 *   open    →(cooldown elapsed)→        half-open
 *   half-open →(success)→               closed
 *   half-open →(failure)→               open
 */

import type { LLMErrorCode } from './llm-error.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening. Default: 5 */
  failureThreshold: number;
  /** Successes in half-open before closing. Default: 2 */
  successThreshold: number;
  /** Milliseconds to wait before probing (half-open). Default: 60_000 */
  cooldownMs: number;
  /** Only count these error codes toward the failure threshold. */
  monitoredErrorCodes: LLMErrorCode[];
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 60_000,
  monitoredErrorCodes: [
    'server_error',
    'timeout',
    'network_error',
    'rate_limited',
  ],
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private openedAt?: number;

  constructor(
    private readonly endpointId: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG
  ) {}

  /** Whether a request should be attempted through this endpoint. */
  isCallAllowed(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      if (Date.now() - this.openedAt! >= this.config.cooldownMs) {
        this.transitionTo('half-open');
        return true; // Allow one probe request
      }
      return false;
    }

    // half-open: allow probe requests
    return true;
  }

  /** Record a successful call (closes breaker after enough successes). */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }
    this.failureCount = 0;
  }

  /** Record a failed call (opens breaker after enough failures). */
  recordFailure(code: LLMErrorCode): void {
    if (!this.config.monitoredErrorCodes.includes(code)) return;

    this.failureCount++;
    if (this.state === 'half-open') {
      // Any monitored failure in half-open immediately re-opens
      this.transitionTo('open');
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  getStatus(): { state: CircuitState; failureCount: number; openedAt?: number; endpointId: string } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt,
      endpointId: this.endpointId,
    };
  }

  private transitionTo(next: CircuitState): void {
    this.state = next;
    if (next === 'open') {
      this.openedAt = Date.now();
      this.successCount = 0;
    }
    if (next === 'closed') {
      this.failureCount = 0;
      this.successCount = 0;
      this.openedAt = undefined;
    }
    if (next === 'half-open') {
      this.successCount = 0;
    }
  }
}
