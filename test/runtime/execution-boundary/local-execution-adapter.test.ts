import { ExecutionService } from '../../../src/app/lifecycle/execution/execution-service.js';
import { LocalExecutionAdapter } from '../../../src/runtime/execution-boundary/local-execution-adapter.js';
import type { ExecutionRunner } from '../../../src/runtime/execution-boundary/execution-runner.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { ExecutionRequest } from '../../../src/runtime/execution-boundary/types.js';
import type { WorkItem } from '../../../src/work-order/types/index.js';

const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-runtime-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  goal_id: 'goal-runtime-1',
  title: 'Runtime boundary work item',
  description: 'Validate execution runner boundary wiring',
  item_type: 'analysis',
  status: 'ready',
  priority: 50,
  dependencies: [],
  blocks: [],
  estimated_effort: 'S',
  retry_count: 0,
  max_retries: 1,
  verification_status: 'not_started',
  ...overrides,
});

const createRequest = (overrides: Partial<ExecutionRequest> = {}): ExecutionRequest => {
  const workItem = createWorkItem();

  return {
    runId: 'scheduler-run-1',
    goalId: workItem.goal_id,
    workItemId: workItem.id,
    workItem,
    model: 'gpt-test',
    laneId: 'main',
    budgetRemaining: { tokens: 500 },
    ...overrides,
  };
};

describe('LocalExecutionAdapter', () => {
  it('executes against the narrow runtime execution runner boundary', async () => {
    const executionRunner: ExecutionRunner = {
      executeWorkItem: jest.fn().mockResolvedValue({
        run: {
          tokens_used: 42,
          time_seconds: 9,
          cost_usd: 1.25,
          artifacts: ['artifact-1'],
          context: {
            actual_model: 'gpt-runtime',
            endpoint_id: 'endpoint-1',
          },
        },
        success: false,
        needsRetry: true,
        errorSignature: 'EXECUTION_FAILED',
      }),
    };

    const adapter = new LocalExecutionAdapter(executionRunner);
    const request = createRequest();
    const result = await adapter.execute(request);

    expect(executionRunner.executeWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: request.workItem.id,
        context: expect.objectContaining({
          model: 'gpt-test',
          laneId: 'main',
          schedulerRunId: 'scheduler-run-1',
        }),
      })
    );
    expect(result).toEqual({
      runId: 'scheduler-run-1',
      workItemId: request.workItemId,
      success: false,
      tokensUsed: 42,
      timeSeconds: 9,
      costUsd: 1.25,
      artifacts: ['artifact-1'],
      actualModel: 'gpt-runtime',
      endpointId: 'endpoint-1',
      error: {
        code: 'EXECUTION_FAILED',
        message: 'Unknown error',
        recoverable: true,
      },
    });
  });

  it('allows ExecutionService to satisfy the runtime execution runner boundary', () => {
    const repository = {
      getGoal: jest.fn(() => null),
      getRunsByWorkItem: jest.fn(() => []),
      createRun: jest.fn(),
      createEscalation: jest.fn(),
      completeRun: jest.fn(),
      getRun: jest.fn(),
      getRepeatedErrorSignatures: jest.fn(() => []),
      createDecision: jest.fn(),
      updateGoalSpending: jest.fn(),
    } as unknown as IWorkOrderRepository;

    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 });
    const runner: ExecutionRunner = service;

    expect(runner).toBe(service);
  });
});
