import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { Run } from '../../../src/work-order/types/index.js';
import { LocalExecutionRunResultNormalizer } from '../../../src/runtime/execution-boundary/local-execution-run-result-normalizer.js';

describe('LocalExecutionRunResultNormalizer', () => {
  function createRun(): Run {
    return {
      id: 'run-1',
      created_at: Date.now(),
      work_item_id: 'work-item-1',
      goal_id: 'goal-1',
      agent_type: 'default',
      run_sequence: 1,
      status: 'running',
      tokens_used: 0,
      cost_usd: 0,
      artifacts: [],
    };
  }

  it('reloads the persisted run and preserves retry classification for retryable failures', () => {
    const run = createRun();
    const persistedRun = {
      ...run,
      status: 'failure' as const,
      execution_log: 'persisted log',
    };
    const repository = {
      getRun: jest.fn(() => persistedRun),
      getRepeatedErrorSignatures: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;
    const normalizer = new LocalExecutionRunResultNormalizer();

    const result = normalizer.normalizeExecutionResult(repository, {
      run,
      workItemId: 'work-item-1',
      workItemRetryCount: 0,
      workItemMaxRetries: 2,
      success: false,
      error: 'worker 17 failed at /tmp/output.txt',
      maxConsecutiveErrors: 3,
    });

    expect(result.run).toBe(persistedRun);
    expect(result.success).toBe(false);
    expect(result.needsRetry).toBe(true);
    expect(result.errorSignature).toBeDefined();
  });

  it('falls back to the in-memory run and suppresses retry when max retries are exhausted', () => {
    const run = createRun();
    const repository = {
      getRun: jest.fn(() => undefined),
      getRepeatedErrorSignatures: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;
    const normalizer = new LocalExecutionRunResultNormalizer();

    const result = normalizer.normalizeExecutionResult(repository, {
      run,
      workItemId: 'work-item-1',
      workItemRetryCount: 2,
      workItemMaxRetries: 2,
      success: false,
      error: 'failed',
      maxConsecutiveErrors: 3,
    });

    expect(result.run).toBe(run);
    expect(result.needsRetry).toBe(false);
  });

  it('suppresses retry when repeated signatures already cross the threshold', () => {
    const run = createRun();
    const repository = {
      getRun: jest.fn(() => run),
      getRepeatedErrorSignatures: jest.fn(() => ['sig-a']),
    } as unknown as IWorkOrderRepository;
    const normalizer = new LocalExecutionRunResultNormalizer();

    const result = normalizer.normalizeExecutionResult(repository, {
      run,
      workItemId: 'work-item-1',
      workItemRetryCount: 0,
      workItemMaxRetries: 2,
      success: false,
      error: 'same failure',
      maxConsecutiveErrors: 3,
    });

    expect(repository.getRepeatedErrorSignatures).toHaveBeenCalledWith('work-item-1', 3);
    expect(result.needsRetry).toBe(false);
  });
});
