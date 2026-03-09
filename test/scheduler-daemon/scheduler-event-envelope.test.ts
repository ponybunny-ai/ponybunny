import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { Goal, Run, WorkItem } from '../../src/work-order/types/index.js';
import { SchedulerEventEnvelopeResolver } from '../../src/scheduler-daemon/scheduler-event-envelope.js';

function createGoal(id: string, context?: Record<string, unknown>): Goal {
  return {
    id,
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'goal',
    description: 'goal',
    success_criteria: [],
    status: 'queued',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    context,
  };
}

function createWorkItem(id: string, goalId: string): WorkItem {
  return {
    id,
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: goalId,
    title: 'wi',
    description: 'wi',
    item_type: 'analysis',
    status: 'queued',
    priority: 1,
    dependencies: [],
    blocks: [],
    estimated_effort: 'S',
    retry_count: 0,
    max_retries: 0,
    verification_status: 'not_started',
  };
}

function createRun(id: string, goalId: string, workItemId: string): Run {
  return {
    id,
    created_at: Date.now(),
    work_item_id: workItemId,
    goal_id: goalId,
    agent_type: 'agent',
    run_sequence: 1,
    status: 'running',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
  };
}

describe('SchedulerEventEnvelopeResolver', () => {
  it('enriches scheduler events from goal context', () => {
    const goal = createGoal('goal-1', {
      sessionId: 'session-1',
      channelType: 'discord',
      channelSessionId: 'discord-1',
    });

    const resolver = new SchedulerEventEnvelopeResolver({
      getGoal: (id: string) => (id === 'goal-1' ? goal : undefined),
      getWorkItem: () => undefined,
      getRun: () => undefined,
    } as unknown as IWorkOrderRepository);

    const result = resolver.resolve({
      type: 'run_started',
      timestamp: 123,
      goalId: 'goal-1',
      runId: 'run-1',
      data: { selected_model: 'x' },
    });

    expect(result.data).toEqual({
      sessionId: 'session-1',
      channelType: 'discord',
      channelSessionId: 'discord-1',
      selected_model: 'x',
    });
  });

  it('resolves goal context through run/workitem chain and preserves explicit event fields', () => {
    const goal = createGoal('goal-2', {
      session_id: 'session-2',
      channel_type: 'telegram',
      channel_session_id: 'tg-2',
    });
    const workItem = createWorkItem('wi-2', 'goal-2');
    const run = createRun('run-2', 'goal-2', 'wi-2');

    const resolver = new SchedulerEventEnvelopeResolver({
      getGoal: (id: string) => (id === 'goal-2' ? goal : undefined),
      getWorkItem: (id: string) => (id === 'wi-2' ? workItem : undefined),
      getRun: (id: string) => (id === 'run-2' ? run : undefined),
    } as unknown as IWorkOrderRepository);

    const result = resolver.resolve({
      type: 'run_completed',
      timestamp: 456,
      runId: 'run-2',
      data: {
        sessionId: 'explicit-session',
        success: true,
      },
    });

    expect(result.data).toEqual({
      sessionId: 'explicit-session',
      channelType: 'telegram',
      channelSessionId: 'tg-2',
      success: true,
    });
  });
});
