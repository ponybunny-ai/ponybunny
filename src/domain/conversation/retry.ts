/**
 * Retry Strategy Domain Types
 */

export type RetryStrategy =
  | 'same_approach'      // Simple retry for transient errors
  | 'parameter_adjust'   // Adjust parameters
  | 'alternative_tool'   // Try different tool/method
  | 'model_upgrade'      // Use more capable model
  | 'decompose_further'  // Break into smaller tasks
  | 'human_guidance';    // Request user assistance

export interface IRetryAdjustment {
  strategy: RetryStrategy;
  description: string;
  changes?: Record<string, unknown>;
}

export interface IFailureAnalysis {
  errorType: 'transient' | 'resource' | 'capability' | 'permission' | 'unknown';
  errorMessage: string;
  suggestedStrategies: RetryStrategy[];
  canAutoRetry: boolean;
  requiresUserInput: boolean;
}

export interface IRetryContext {
  attemptNumber: number;
  maxAttempts: number;
  previousStrategies: RetryStrategy[];
  failureHistory: IFailureAnalysis[];
}

export const RETRY_STRATEGY_ORDER: RetryStrategy[] = [
  'same_approach',
  'parameter_adjust',
  'alternative_tool',
  'model_upgrade',
  'decompose_further',
  'human_guidance',
];

export const MAX_AUTO_RETRY_ATTEMPTS = 3;
