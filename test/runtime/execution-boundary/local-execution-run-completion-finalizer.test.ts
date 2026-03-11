import { LocalExecutionRunCompletionFinalizer } from '../../../src/runtime/execution-boundary/local-execution-run-completion-finalizer.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';

describe('LocalExecutionRunCompletionFinalizer', () => {
  it('builds the same run completion payload shape from execution results', () => {
    const finalizer = new LocalExecutionRunCompletionFinalizer();

    const completion = finalizer.buildRunCompletion({
      executionResult: {
        success: false,
        error: 'cycle failed',
        tokensUsed: 14,
        costUsd: 0.27,
        actualModel: 'actual-model',
        endpointId: 'endpoint-1',
        artifactIds: ['artifact-a', 'artifact-b'],
      },
      executionLog: 'finalized log',
      timeSeconds: 17,
      selectedModel: 'selected-model',
      requestedModel: 'requested-model',
    });

    expect(completion).toEqual({
      status: 'failure',
      error_message: 'cycle failed',
      tokens_used: 14,
      time_seconds: 17,
      cost_usd: 0.27,
      artifacts: ['artifact-a', 'artifact-b'],
      execution_log: 'finalized log',
      context: {
        selected_model: 'selected-model',
        requested_model: 'requested-model',
        actual_model: 'actual-model',
        endpoint_id: 'endpoint-1',
      },
    });
  });

  it('persists goal spending with the same rounded minutes and warning-tolerant behavior', () => {
    const finalizer = new LocalExecutionRunCompletionFinalizer();
    const repository = {
      updateGoalSpending: jest.fn(),
    } as unknown as IWorkOrderRepository;

    finalizer.persistGoalSpending(repository, {
      goalId: 'goal-1',
      tokensUsed: 25,
      timeSeconds: 61,
      costUsd: 0.4,
    });

    expect(repository.updateGoalSpending).toHaveBeenCalledWith('goal-1', 25, 2, 0.4);
  });

  it('swallows goal spending persistence failures', () => {
    const finalizer = new LocalExecutionRunCompletionFinalizer();
    const repository = {
      updateGoalSpending: jest.fn(() => {
        throw new Error('write failed');
      }),
    } as unknown as IWorkOrderRepository;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    finalizer.persistGoalSpending(repository, {
      goalId: 'goal-1',
      tokensUsed: 25,
      timeSeconds: 30,
      costUsd: 0.4,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[ExecutionService] Failed to update goal spending after run completion:',
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });
});
