import { TaskBridge } from '../../../src/app/conversation/task-bridge.js';
import type { Goal, WorkItem } from '../../../src/work-order/types/index.js';

describe('TaskBridge conversation linkage', () => {
  it('writes sessionId + turnId linkage into goal context', async () => {
    const createGoal = jest.fn((params: Partial<Goal>): Goal => ({
      id: 'goal-ctx-1',
      created_at: Date.now(),
      updated_at: Date.now(),
      title: params.title ?? 't',
      description: params.description ?? 'd',
      success_criteria: params.success_criteria ?? [],
      status: 'queued',
      priority: params.priority ?? 50,
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
      context: params.context,
    }));

    const repository = {
      createGoal,
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      getWorkItemsByGoal: jest.fn((): WorkItem[] => []),
    };

    const bridge = new TaskBridge(
      repository,
      () => null
    );

    await bridge.createGoalFromConversation(
      {
        title: 'Implement feature',
        description: 'Need a full implementation',
        successCriteria: ['tests pass'],
        constraints: [],
        priority: 'medium',
      },
      {
        id: 'ses-ctx-1',
        personaId: 'pony-default',
      } as never,
      'turn-42'
    );

    expect(createGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          createdViaConversation: true,
          sessionId: 'ses-ctx-1',
          turnId: 'turn-42',
        }),
      })
    );
  });
});
