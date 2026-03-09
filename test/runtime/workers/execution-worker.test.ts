import type { ExecutionPort, ExecutionRequest, ExecutionResult } from '../../../src/runtime/execution-boundary/index.js';
import { MemoryEventBus } from '../../../src/runtime/event-bus/index.js';
import { LocalExecutionWorker } from '../../../src/runtime/workers/index.js';

describe('LocalExecutionWorker', () => {
  let bus: MemoryEventBus;
  let executionPort: jest.Mocked<ExecutionPort>;
  let worker: LocalExecutionWorker;
  let publishedEvents: Array<{ type: string; payload?: unknown; runId?: string; goalId?: string; workItemId?: string; source: string }>;

  const request: ExecutionRequest = {
    runId: 'run-123',
    goalId: 'goal-123',
    workItemId: 'workitem-123',
    workItem: {
      id: 'workitem-123',
      goal_id: 'goal-123',
      title: 'Execute something',
      description: 'Test work item',
      item_type: 'code',
      status: 'ready',
      priority: 1,
      dependencies: [],
      blocks: [],
      estimated_effort: 'M',
      created_at: 1,
      updated_at: 1,
      retry_count: 0,
      max_retries: 3,
      verification_status: 'not_started',
    },
    model: 'gpt-test',
    laneId: 'main',
    budgetRemaining: { remainingUsd: 1 },
  };

  beforeEach(() => {
    bus = new MemoryEventBus();
    executionPort = {
      execute: jest.fn(),
      abort: jest.fn(),
    };
    worker = new LocalExecutionWorker(executionPort, bus);
    publishedEvents = [];

    bus.subscribeAll((event) => {
      publishedEvents.push({
        type: event.type,
        payload: event.payload,
        runId: event.runId,
        goalId: event.goalId,
        workItemId: event.workItemId,
        source: event.source,
      });
    });
  });

  it('executes task.ready payloads and emits execution.completed on success', async () => {
    const result: ExecutionResult = {
      runId: request.runId,
      workItemId: request.workItemId,
      success: true,
      tokensUsed: 42,
      timeSeconds: 3,
      costUsd: 0.12,
      artifacts: ['artifact-1'],
    };
    executionPort.execute.mockResolvedValue(result);
    worker.start();

    await bus.publish({
      id: 'evt-1',
      type: 'task.ready',
      source: 'test',
      timestamp: 1,
      runId: request.runId,
      goalId: request.goalId,
      workItemId: request.workItemId,
      payload: request,
    });

    expect(executionPort.execute).toHaveBeenCalledWith(request);
    expect(publishedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'execution.started',
        source: 'local-execution-worker',
        runId: request.runId,
        goalId: request.goalId,
        workItemId: request.workItemId,
        payload: { request },
      }),
      expect.objectContaining({
        type: 'execution.completed',
        source: 'local-execution-worker',
        runId: request.runId,
        goalId: request.goalId,
        workItemId: request.workItemId,
        payload: { request, result },
      }),
    ]));
  });

  it('emits execution.failed when ExecutionPort returns an unsuccessful result', async () => {
    executionPort.execute.mockResolvedValue({
      runId: request.runId,
      workItemId: request.workItemId,
      success: false,
      tokensUsed: 0,
      timeSeconds: 1,
      costUsd: 0,
      artifacts: [],
      error: {
        code: 'MODEL_ERROR',
        message: 'Execution failed',
        recoverable: true,
      },
    });
    worker.start();

    await bus.publish({
      id: 'evt-2',
      type: 'task.ready',
      source: 'test',
      timestamp: 2,
      payload: request,
    });

    expect(publishedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'execution.failed',
        source: 'local-execution-worker',
        runId: request.runId,
        goalId: request.goalId,
        workItemId: request.workItemId,
        payload: {
          request,
          error: {
            code: 'MODEL_ERROR',
            message: 'Execution failed',
            recoverable: true,
          },
          result: {
            runId: request.runId,
            goalId: request.goalId,
            workItemId: request.workItemId,
            source: 'local-execution-worker',
            success: false,
            outcome: 'failure',
            tokensUsed: 0,
            timeSeconds: 1,
            costUsd: 0,
            artifacts: [],
            error: {
              code: 'MODEL_ERROR',
              message: 'Execution failed',
              recoverable: true,
            },
          },
        },
      }),
    ]));
  });

  it('emits an enriched failed result when ExecutionPort throws', async () => {
    executionPort.execute.mockRejectedValue(new Error('boom'));
    worker.start();

    await bus.publish({
      id: 'evt-2b',
      type: 'task.ready',
      source: 'test',
      timestamp: 3,
      payload: request,
    });

    expect(publishedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'execution.failed',
        source: 'local-execution-worker',
        runId: request.runId,
        goalId: request.goalId,
        workItemId: request.workItemId,
        payload: {
          request,
          error: {
            code: 'EXECUTION_WORKER_EXCEPTION',
            message: 'boom',
            recoverable: true,
          },
          result: {
            runId: request.runId,
            goalId: request.goalId,
            workItemId: request.workItemId,
            source: 'local-execution-worker',
            success: false,
            outcome: 'failure',
            tokensUsed: 0,
            timeSeconds: 0,
            costUsd: 0,
            artifacts: [],
            error: {
              code: 'EXECUTION_WORKER_EXCEPTION',
              message: 'boom',
              recoverable: true,
            },
          },
        },
      }),
    ]));
  });

  it('suppresses duplicate task.ready events for the same runId', async () => {
    executionPort.execute.mockResolvedValue({
      runId: request.runId,
      workItemId: request.workItemId,
      success: true,
      tokensUsed: 1,
      timeSeconds: 1,
      costUsd: 0,
      artifacts: [],
    });
    worker.start();

    await bus.publish({
      id: 'evt-3',
      type: 'task.ready',
      source: 'test',
      timestamp: 4,
      payload: request,
    });
    await bus.publish({
      id: 'evt-4',
      type: 'task.ready',
      source: 'test',
      timestamp: 5,
      payload: request,
    });

    expect(executionPort.execute).toHaveBeenCalledTimes(1);
  });
});
