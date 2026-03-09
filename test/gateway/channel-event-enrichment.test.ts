import { ChannelEventEnricher } from '../../src/gateway/channels/channel-event-enricher.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { Goal, Run, WorkItem } from '../../src/work-order/types/index.js';

function createGoal(id: string, context?: Record<string, unknown>): Goal {
  return {
    id,
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 't',
    description: 'd',
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
    title: 'w',
    description: 'w',
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
    agent_type: 'test',
    run_sequence: 1,
    status: 'running',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
  };
}

function createEnricher(repository: Partial<IWorkOrderRepository>): ChannelEventEnricher {
  return new ChannelEventEnricher(repository as IWorkOrderRepository);
}

describe('ChannelEventEnricher', () => {
  it('resolves session and channel fields from goal context', () => {
    const goal = createGoal('goal-1', {
      sessionId: 'session-1',
      channelType: 'discord',
      channelSessionId: 'discord-1',
    });
    const enricher = createEnricher({
      getGoal: (id: string) => (id === 'goal-1' ? goal : undefined),
      getWorkItem: () => undefined,
      getRun: () => undefined,
    });

    const result = enricher.resolveFromDomainIds('goal-1', undefined, undefined) as {
      sessionId?: string;
      channelType?: string;
      channelSessionId?: string;
    };

    expect(result).toEqual({
      sessionId: 'session-1',
      channelType: 'discord',
      channelSessionId: 'discord-1',
    });
  });

  it('resolves goal context via workitem and run relationships', () => {
    const goal = createGoal('goal-2', {
      session_id: 'session-2',
      channel_type: 'telegram',
      channel_session_id: 'tg-2',
    });
    const workItem = createWorkItem('work-2', 'goal-2');
    const run = createRun('run-2', 'goal-2', 'work-2');
    const enricher = createEnricher({
      getGoal: (id: string) => (id === 'goal-2' ? goal : undefined),
      getWorkItem: (id: string) => (id === 'work-2' ? workItem : undefined),
      getRun: (id: string) => (id === 'run-2' ? run : undefined),
    });

    const fromWorkItem = enricher.resolveFromDomainIds(undefined, 'work-2', undefined);
    const fromRun = enricher.resolveFromDomainIds(undefined, undefined, 'run-2');

    expect(fromWorkItem).toEqual({
      sessionId: 'session-2',
      channelType: 'telegram',
      channelSessionId: 'tg-2',
    });
    expect(fromRun).toEqual({
      sessionId: 'session-2',
      channelType: 'telegram',
      channelSessionId: 'tg-2',
    });
  });
});
