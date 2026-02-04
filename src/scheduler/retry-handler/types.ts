/**
 * Retry Handler Types
 */

import type { RetryDecision, RetryStrategy, ExecutionError } from '../types.js';
import type { WorkItem, Run } from '../../work-order/types/index.js';

export interface RetryConfig {
  /** Maximum retries before escalation */
  maxRetries: number;
  /** Base delay in ms for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Jitter factor (0-1) to add randomness to delays */
  jitterFactor: number;
}

export interface ErrorPattern {
  /** Error code or signature pattern */
  pattern: string;
  /** Whether this error is recoverable */
  recoverable: boolean;
  /** Suggested retry strategy */
  strategy: RetryStrategy;
  /** Description of the error */
  description: string;
}

export interface IRetryHandler {
  /** Decide retry strategy based on error */
  decideRetry(workItem: WorkItem, error: ExecutionError, run: Run): RetryDecision;

  /** Get retry delay based on attempt count */
  getRetryDelay(attemptCount: number): number;

  /** Check if error matches a known pattern */
  matchErrorPattern(error: ExecutionError): ErrorPattern | null;

  /** Register a custom error pattern */
  registerErrorPattern(pattern: ErrorPattern): void;
}
