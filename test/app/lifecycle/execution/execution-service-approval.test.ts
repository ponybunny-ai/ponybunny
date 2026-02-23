import { ExecutionService } from '../../../../src/app/lifecycle/execution/execution-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { WorkItem } from '../../../../src/work-order/types/index.js';

const createWorkItem = (): WorkItem => ({
  id: 'wi-approval-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  goal_id: 'goal-approval-1',
  title: 'Run approval task',
  description: 'Execute command requiring human approval',
  item_type: 'analysis',
  status: 'ready',
  priority: 50,
  dependencies: [],
  blocks: [],
  estimated_effort: 'S',
  retry_count: 0,
  max_retries: 1,
  verification_status: 'not_started',
  context: {
    approval_required: true,
    approval_actions: ['execute_command'],
    routeContext: {
      source: 'gateway.message',
      senderIsOwner: false,
    },
  },
});

describe('ExecutionService human approval gate', () => {
  it('blocks execution and creates escalation when approval is required', async () => {
    const runRecord = {
      id: 'run-approval-1',
      work_item_id: 'wi-approval-1',
      goal_id: 'goal-approval-1',
      agent_type: 'default',
      run_sequence: 1,
      status: 'failure',
      created_at: Date.now(),
      tokens_used: 0,
      cost_usd: 0,
      artifacts: [],
    };

    const repository = {
      getGoal: jest.fn(() => null),
      getRunsByWorkItem: jest.fn(() => []),
      createRun: jest.fn(() => runRecord),
      createEscalation: jest.fn(() => ({})),
      completeRun: jest.fn(),
      getRun: jest.fn(() => runRecord),
      getRepeatedErrorSignatures: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;

    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 });
    const result = await service.executeWorkItem(createWorkItem());

    expect(result.success).toBe(false);
    expect(result.needsRetry).toBe(false);
    expect(repository.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        work_item_id: 'wi-approval-1',
        goal_id: 'goal-approval-1',
        escalation_type: 'risk',
      })
    );
    expect(repository.completeRun).toHaveBeenCalledWith(
      'run-approval-1',
      expect.objectContaining({
        status: 'failure',
      })
    );
  });
});
