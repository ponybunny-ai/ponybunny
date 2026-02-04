/**
 * Retry Handler Implementation
 *
 * Decides retry strategies based on error patterns and work item state.
 */

import type { WorkItem } from '../../work-order/types/index.js';
import type { RetryDecision, ExecutionError } from '../types.js';
import type { IRetryHandler, RetryConfig, ErrorPattern } from './types.js';

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.2,
};

/**
 * Default error patterns for common failure scenarios
 */
const DEFAULT_ERROR_PATTERNS: ErrorPattern[] = [
  // Rate limiting errors - retry with same model after delay
  {
    pattern: 'rate_limit',
    recoverable: true,
    strategy: 'same_model',
    description: 'Rate limit exceeded, retry after delay',
  },
  {
    pattern: '429',
    recoverable: true,
    strategy: 'same_model',
    description: 'Too many requests, retry after delay',
  },

  // Temporary server errors - retry with same model
  {
    pattern: '500',
    recoverable: true,
    strategy: 'same_model',
    description: 'Internal server error, retry',
  },
  {
    pattern: '502',
    recoverable: true,
    strategy: 'same_model',
    description: 'Bad gateway, retry',
  },
  {
    pattern: '503',
    recoverable: true,
    strategy: 'same_model',
    description: 'Service unavailable, retry',
  },
  {
    pattern: '504',
    recoverable: true,
    strategy: 'same_model',
    description: 'Gateway timeout, retry',
  },
  {
    pattern: 'timeout',
    recoverable: true,
    strategy: 'same_model',
    description: 'Request timeout, retry',
  },
  {
    pattern: 'ECONNRESET',
    recoverable: true,
    strategy: 'same_model',
    description: 'Connection reset, retry',
  },
  {
    pattern: 'ETIMEDOUT',
    recoverable: true,
    strategy: 'same_model',
    description: 'Connection timeout, retry',
  },

  // Context/capability errors - try different model
  {
    pattern: 'context_length',
    recoverable: true,
    strategy: 'switch_model',
    description: 'Context too long, try model with larger context',
  },
  {
    pattern: 'max_tokens',
    recoverable: true,
    strategy: 'switch_model',
    description: 'Max tokens exceeded, try different model',
  },
  {
    pattern: 'unsupported',
    recoverable: true,
    strategy: 'switch_model',
    description: 'Feature unsupported, try different model',
  },

  // Authentication errors - not recoverable without intervention
  {
    pattern: '401',
    recoverable: false,
    strategy: 'escalate',
    description: 'Authentication failed, requires credential update',
  },
  {
    pattern: '403',
    recoverable: false,
    strategy: 'escalate',
    description: 'Access forbidden, requires permission',
  },
  {
    pattern: 'invalid_api_key',
    recoverable: false,
    strategy: 'escalate',
    description: 'Invalid API key, requires credential update',
  },

  // Content policy errors - escalate
  {
    pattern: 'content_policy',
    recoverable: false,
    strategy: 'escalate',
    description: 'Content policy violation, requires human review',
  },
  {
    pattern: 'safety',
    recoverable: false,
    strategy: 'escalate',
    description: 'Safety filter triggered, requires human review',
  },

  // Budget errors - escalate
  {
    pattern: 'insufficient_quota',
    recoverable: false,
    strategy: 'escalate',
    description: 'Quota exceeded, requires budget increase',
  },
  {
    pattern: 'billing',
    recoverable: false,
    strategy: 'escalate',
    description: 'Billing issue, requires account update',
  },
];

export class RetryHandler implements IRetryHandler {
  private config: RetryConfig;
  private errorPatterns: ErrorPattern[];

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.errorPatterns = [...DEFAULT_ERROR_PATTERNS];
  }

  /**
   * Decide retry strategy based on error and work item state
   */
  decideRetry(workItem: WorkItem, error: ExecutionError, _run: unknown): RetryDecision {
    // Check if max retries exceeded
    if (workItem.retry_count >= workItem.max_retries) {
      return {
        shouldRetry: false,
        strategy: 'escalate',
        reason: `Max retries (${workItem.max_retries}) exceeded`,
      };
    }

    // Check if error is recoverable
    if (!error.recoverable) {
      return {
        shouldRetry: false,
        strategy: 'escalate',
        reason: `Non-recoverable error: ${error.message}`,
      };
    }

    // Match error pattern
    const pattern = this.matchErrorPattern(error);
    if (pattern) {
      return this.buildRetryDecision(workItem, error, pattern);
    }

    // Use suggested action from error if available
    if (error.suggestedAction) {
      return this.buildRetryDecisionFromSuggestion(workItem, error);
    }

    // Default: retry with same model for recoverable errors
    return {
      shouldRetry: true,
      strategy: 'same_model',
      reason: 'Recoverable error, retrying with same model',
      delayMs: this.getRetryDelay(workItem.retry_count),
    };
  }

  /**
   * Build retry decision from matched pattern
   */
  private buildRetryDecision(
    workItem: WorkItem,
    _error: ExecutionError,
    pattern: ErrorPattern
  ): RetryDecision {
    if (!pattern.recoverable) {
      return {
        shouldRetry: false,
        strategy: pattern.strategy,
        reason: pattern.description,
      };
    }

    const strategy = pattern.strategy;
    const delayMs = this.getRetryDelay(workItem.retry_count);

    if (strategy === 'switch_model') {
      return {
        shouldRetry: true,
        strategy: 'switch_model',
        reason: pattern.description,
        delayMs,
        // Note: nextModel should be determined by ModelSelector
      };
    }

    return {
      shouldRetry: true,
      strategy,
      reason: pattern.description,
      delayMs,
    };
  }

  /**
   * Build retry decision from error's suggested action
   */
  private buildRetryDecisionFromSuggestion(
    workItem: WorkItem,
    error: ExecutionError
  ): RetryDecision {
    const action = error.suggestedAction!;

    if (action === 'escalate') {
      return {
        shouldRetry: false,
        strategy: 'escalate',
        reason: error.message,
      };
    }

    // Map 'retry' to 'same_model' strategy
    const strategy = action === 'retry' ? 'same_model' : action;

    return {
      shouldRetry: true,
      strategy,
      reason: `Suggested action: ${action}`,
      delayMs: this.getRetryDelay(workItem.retry_count),
    };
  }

  /**
   * Get retry delay with exponential backoff and jitter
   */
  getRetryDelay(attemptCount: number): number {
    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attemptCount);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter
    const jitter = cappedDelay * this.config.jitterFactor * Math.random();

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Match error against known patterns
   */
  matchErrorPattern(error: ExecutionError): ErrorPattern | null {
    const errorString = `${error.code} ${error.message} ${error.signature || ''}`.toLowerCase();

    for (const pattern of this.errorPatterns) {
      if (errorString.includes(pattern.pattern.toLowerCase())) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Register a custom error pattern
   */
  registerErrorPattern(pattern: ErrorPattern): void {
    // Add to beginning so custom patterns take precedence
    this.errorPatterns.unshift(pattern);
  }

  /**
   * Remove an error pattern
   */
  removeErrorPattern(patternString: string): boolean {
    const index = this.errorPatterns.findIndex(p => p.pattern === patternString);
    if (index !== -1) {
      this.errorPatterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all registered error patterns
   */
  getErrorPatterns(): ErrorPattern[] {
    return [...this.errorPatterns];
  }

  /**
   * Update retry config
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current config
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }
}
