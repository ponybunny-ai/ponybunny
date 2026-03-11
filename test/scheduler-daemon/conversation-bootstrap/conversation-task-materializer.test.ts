import type { EffectiveModelResolution } from '../../../src/infra/llm/provider-manager/effective-model-resolution.js';
import { ConversationTaskMaterializer } from '../../../src/scheduler-daemon/conversation-bootstrap/conversation-task-materializer.js';
import type { Goal, WorkItem } from '../../../src/work-order/types/index.js';

describe('ConversationTaskMaterializer', () => {
  it('preserves selected-model projection, first work-item creation, and scheduler submission', async () => {
    const createdGoal: Goal = {
      id: 'goal-1',
      created_at: Date.now(),
      updated_at: Date.now(),
      title: 'test goal',
      description: 'test description',
      success_criteria: [],
      status: 'queued',
      priority: 5,
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
      context: undefined,
    };
    const createdWorkItem: WorkItem = {
      id: 'wi-1',
      created_at: Date.now(),
      updated_at: Date.now(),
      goal_id: 'goal-1',
      title: 'test goal',
      description: 'test description',
      item_type: 'analysis',
      status: 'queued',
      priority: 5,
      dependencies: [],
      blocks: [],
      estimated_effort: 'M',
      retry_count: 0,
      max_retries: 3,
      verification_status: 'not_started',
      context: undefined,
    };

    const repository = {
      createGoal: jest.fn((params: Partial<Goal>) => ({
        ...createdGoal,
        title: params.title ?? createdGoal.title,
        description: params.description ?? createdGoal.description,
        priority: params.priority ?? createdGoal.priority,
        success_criteria: params.success_criteria ?? createdGoal.success_criteria,
        context: params.context,
      })),
      createWorkItem: jest.fn((params: Partial<WorkItem>) => ({
        ...createdWorkItem,
        goal_id: params.goal_id ?? createdWorkItem.goal_id,
        title: params.title ?? createdWorkItem.title,
        description: params.description ?? createdWorkItem.description,
        item_type: params.item_type ?? createdWorkItem.item_type,
        priority: params.priority ?? createdWorkItem.priority,
        dependencies: params.dependencies ?? createdWorkItem.dependencies,
        context: params.context,
      })),
    };
    const scheduler = {
      submitGoal: jest.fn(async () => undefined),
    };
    const resolveEffectiveModel = jest.fn((agentId?: string): EffectiveModelResolution | undefined => (
      agentId === 'planning'
        ? { model: 'openai.gpt-5.3', source: 'agent_runner_hint' }
        : undefined
    ));
    const materializer = new ConversationTaskMaterializer(
      repository as never,
      () => scheduler as never,
      resolveEffectiveModel
    );

    const result = await materializer.materializeGoalFromConversation(
      {
        title: 'Build feature',
        description: 'do it',
        successCriteria: ['passes'],
        priority: 'medium',
      },
      { id: 'ses-1', personaId: 'pony-default' } as never,
      'turn-1',
      { sourceAgentId: 'planning' }
    );

    expect(resolveEffectiveModel).toHaveBeenCalledWith('planning');
    expect(repository.createGoal).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        sessionId: 'ses-1',
        turnId: 'turn-1',
        selected_model: 'openai.gpt-5.3',
      }),
    }));
    expect(repository.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        sessionId: 'ses-1',
        turnId: 'turn-1',
        selected_model: 'openai.gpt-5.3',
        model: 'openai.gpt-5.3',
      }),
    }));
    expect(scheduler.submitGoal).toHaveBeenCalledWith(expect.objectContaining({
      id: 'goal-1',
    }));
    expect(result).toEqual({
      goalId: 'goal-1',
      workItems: [
        {
          id: 'wi-1',
          title: 'Build feature',
          status: 'queued',
        },
      ],
    });
  });
});
