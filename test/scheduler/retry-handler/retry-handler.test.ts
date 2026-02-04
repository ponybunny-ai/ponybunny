import { RetryHandler } from '../../../src/scheduler/retry-handler/retry-handler.js';
import type { WorkItem } from '../../../src/work-order/types/index.js';
import type { ExecutionError } from '../../../src/scheduler/types.js';

describe('RetryHandler', () => {
  let handler: RetryHandler;

  const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'Test description',
    item_type: 'code',
    status: 'in_progress',
    priority: 1,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    ...overrides,
  });

  const createError = (overrides: Partial<ExecutionError> = {}): ExecutionError => ({
    code: 'ERROR',
    message: 'Test error',
    recoverable: true,
    ...overrides,
  });

  beforeEach(() => {
    handler = new RetryHandler();
  });

  describe('decideRetry', () => {
    it('should not retry when max retries exceeded', () => {
      const workItem = createWorkItem({
        retry_count: 3,
        max_retries: 3,
      });
      const error = createError();

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(false);
      expect(decision.strategy).toBe('escalate');
      expect(decision.reason).toContain('Max retries');
    });

    it('should not retry non-recoverable errors', () => {
      const workItem = createWorkItem();
      const error = createError({ recoverable: false });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(false);
      expect(decision.strategy).toBe('escalate');
      expect(decision.reason).toContain('Non-recoverable');
    });

    it('should retry recoverable errors with same model', () => {
      const workItem = createWorkItem();
      const error = createError();

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(true);
      expect(decision.strategy).toBe('same_model');
      expect(decision.delayMs).toBeGreaterThan(0);
    });

    it('should use suggested action when provided', () => {
      const workItem = createWorkItem();
      const error = createError({ suggestedAction: 'switch_model' });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(true);
      expect(decision.strategy).toBe('switch_model');
    });

    it('should map retry suggestion to same_model', () => {
      const workItem = createWorkItem();
      const error = createError({ suggestedAction: 'retry' });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(true);
      expect(decision.strategy).toBe('same_model');
    });

    it('should not retry when escalate is suggested', () => {
      const workItem = createWorkItem();
      const error = createError({ suggestedAction: 'escalate' });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(false);
      expect(decision.strategy).toBe('escalate');
    });
  });

  describe('error pattern matching', () => {
    it('should match rate limit errors', () => {
      const workItem = createWorkItem();
      const error = createError({
        code: '429',
        message: 'Rate limit exceeded',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(true);
      expect(decision.strategy).toBe('same_model');
    });

    it('should match timeout errors', () => {
      const workItem = createWorkItem();
      const error = createError({
        code: 'ETIMEDOUT',
        message: 'Connection timeout',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(true);
      expect(decision.strategy).toBe('same_model');
    });

    it('should match context length errors and switch model', () => {
      const workItem = createWorkItem();
      const error = createError({
        code: 'context_length_exceeded',
        message: 'Context length exceeded',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(true);
      expect(decision.strategy).toBe('switch_model');
    });

    it('should match auth errors and escalate', () => {
      const workItem = createWorkItem();
      const error = createError({
        code: '401',
        message: 'Unauthorized',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(false);
      expect(decision.strategy).toBe('escalate');
    });

    it('should match content policy errors and escalate', () => {
      const workItem = createWorkItem();
      const error = createError({
        code: 'content_policy_violation',
        message: 'Content policy violation',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(false);
      expect(decision.strategy).toBe('escalate');
    });
  });

  describe('getRetryDelay', () => {
    it('should use exponential backoff', () => {
      const delay0 = handler.getRetryDelay(0);
      const delay1 = handler.getRetryDelay(1);
      const delay2 = handler.getRetryDelay(2);

      // Base delay is 1000ms, so:
      // attempt 0: ~1000ms
      // attempt 1: ~2000ms
      // attempt 2: ~4000ms
      expect(delay0).toBeGreaterThanOrEqual(1000);
      expect(delay0).toBeLessThan(1500); // With jitter
      expect(delay1).toBeGreaterThanOrEqual(2000);
      expect(delay2).toBeGreaterThanOrEqual(4000);
    });

    it('should cap at max delay', () => {
      const delay = handler.getRetryDelay(10); // Would be 1024000ms without cap

      expect(delay).toBeLessThanOrEqual(36000); // maxDelay (30000) + jitter
    });
  });

  describe('custom error patterns', () => {
    it('should allow registering custom patterns', () => {
      handler.registerErrorPattern({
        pattern: 'custom_error',
        recoverable: true,
        strategy: 'switch_model',
        description: 'Custom error pattern',
      });

      const workItem = createWorkItem();
      const error = createError({
        code: 'custom_error',
        message: 'A custom error occurred',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.strategy).toBe('switch_model');
    });

    it('should prioritize custom patterns over defaults', () => {
      // Register custom pattern that overrides default 429 behavior
      handler.registerErrorPattern({
        pattern: '429',
        recoverable: false,
        strategy: 'escalate',
        description: 'Custom 429 handling',
      });

      const workItem = createWorkItem();
      const error = createError({
        code: '429',
        message: 'Rate limit',
      });

      const decision = handler.decideRetry(workItem, error, {});

      expect(decision.shouldRetry).toBe(false);
      expect(decision.strategy).toBe('escalate');
    });

    it('should remove error patterns', () => {
      const initialCount = handler.getErrorPatterns().length;

      handler.registerErrorPattern({
        pattern: 'temp_pattern',
        recoverable: true,
        strategy: 'same_model',
        description: 'Temporary',
      });

      expect(handler.getErrorPatterns().length).toBe(initialCount + 1);

      const removed = handler.removeErrorPattern('temp_pattern');
      expect(removed).toBe(true);
      expect(handler.getErrorPatterns().length).toBe(initialCount);
    });
  });

  describe('configuration', () => {
    it('should allow custom config', () => {
      const customHandler = new RetryHandler({
        maxRetries: 5,
        baseDelayMs: 500,
        maxDelayMs: 10000,
        jitterFactor: 0.1,
      });

      const config = customHandler.getConfig();

      expect(config.maxRetries).toBe(5);
      expect(config.baseDelayMs).toBe(500);
      expect(config.maxDelayMs).toBe(10000);
      expect(config.jitterFactor).toBe(0.1);
    });

    it('should allow updating config', () => {
      handler.updateConfig({ maxRetries: 10 });

      expect(handler.getConfig().maxRetries).toBe(10);
    });
  });

  describe('matchErrorPattern', () => {
    it('should return null for unknown errors', () => {
      const error = createError({
        code: 'UNKNOWN_ERROR_XYZ',
        message: 'Something completely unknown',
      });

      const pattern = handler.matchErrorPattern(error);

      expect(pattern).toBeNull();
    });

    it('should match by signature', () => {
      const error = createError({
        code: 'ERROR',
        message: 'Some error',
        signature: 'rate_limit_hash',
      });

      const pattern = handler.matchErrorPattern(error);

      expect(pattern).not.toBeNull();
      expect(pattern?.pattern).toBe('rate_limit');
    });
  });
});
