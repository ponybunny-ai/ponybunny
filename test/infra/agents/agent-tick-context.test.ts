import { getAgentTickContext, isAgentTickContext } from '../../../src/infra/agents/agent-tick-context.js';
import type { WorkItem } from '../../../src/work-order/types/index.js';

const createWorkItem = (context: unknown): WorkItem => ({
  id: 'wi-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  goal_id: 'goal-1',
  title: 'agent tick',
  description: 'agent tick',
  item_type: 'analysis',
  status: 'ready',
  priority: 50,
  dependencies: [],
  blocks: [],
  estimated_effort: 'S',
  retry_count: 0,
  max_retries: 1,
  verification_status: 'not_started',
  context: context as WorkItem['context'],
});

describe('agent-tick-context', () => {
  it('accepts valid contexts with null policy snapshot', () => {
    const context = {
      kind: 'agent_tick',
      agent_id: 'agent-1',
      definition_hash: 'hash-1',
      run_key: 'run-1',
      scheduled_for_ms: 1700000000000,
      policy_snapshot: null,
    };

    expect(isAgentTickContext(context)).toBe(true);
  });

  it('rejects invalid context field types', () => {
    expect(
      isAgentTickContext({
        kind: 'agent_tick',
        agent_id: 'agent-1',
        definition_hash: 'hash-1',
        run_key: 'run-1',
        scheduled_for_ms: '1700000000000',
        policy_snapshot: {},
      })
    ).toBe(false);

    expect(
      isAgentTickContext({
        kind: 'agent_tick',
        agent_id: 'agent-1',
        definition_hash: 'hash-1',
        run_key: 'run-1',
        scheduled_for_ms: 1700000000000,
        policy_snapshot: 'invalid',
      })
    ).toBe(false);
  });

  it('normalizes route_context alias into routeContext on extraction', () => {
    const workItem = createWorkItem({
      kind: 'agent_tick',
      agent_id: 'agent-1',
      definition_hash: 'hash-1',
      run_key: 'run-1',
      scheduled_for_ms: 1700000000000,
      policy_snapshot: {},
      route_context: {
        source: 'gateway.message',
        provider_id: 'openai/gpt-5.3-codex',
        sender_is_owner: false,
      },
    });

    const context = getAgentTickContext(workItem);
    expect(context).not.toBeNull();
    expect(context?.routeContext).toEqual(
      expect.objectContaining({
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
        senderIsOwner: false,
      })
    );
  });
});
