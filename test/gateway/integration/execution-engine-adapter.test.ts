import type { IExecutionService } from '../../../src/app/lifecycle/stage-interfaces.js';
import type { AgentAService } from '../../../src/app/agents/agent-a/agent-a-service.js';
import { ExecutionEngineAdapter } from '../../../src/gateway/integration/execution-engine-adapter.js';
import { getGlobalAgentRegistry } from '../../../src/infra/agents/agent-registry.js';
import { MarketListenerRunner } from '../../../src/infra/agents/market-listener-runner.js';
import type { AgentRunner } from '../../../src/infra/agents/runner-types.js';
import { getGlobalRunnerRegistry } from '../../../src/infra/agents/runner-registry.js';
import type { Run, WorkItem } from '../../../src/work-order/types/index.js';

const resetGlobalRegistries = (): void => {
  const registry = getGlobalAgentRegistry() as unknown as {
    agents: Map<string, unknown>;
    lastGood: Map<string, unknown>;
    lastLoadedAt: number;
    loading: Promise<void> | null;
  };
  registry.agents = new Map();
  registry.lastGood = new Map();
  registry.lastLoadedAt = 0;
  registry.loading = null;

  const runnerRegistry = getGlobalRunnerRegistry() as unknown as {
    runners: Map<string, AgentRunner>;
  };
  runnerRegistry.runners = new Map();
};

const createWorkItem = (overrides: Partial<WorkItem>): WorkItem => ({
  id: 'wi-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  goal_id: 'goal-1',
  title: 'Test Work Item',
  description: 'Test description',
  item_type: 'analysis',
  status: 'ready',
  priority: 50,
  dependencies: [],
  blocks: [],
  estimated_effort: 'M',
  retry_count: 0,
  max_retries: 3,
  verification_status: 'not_started',
  ...overrides,
});

describe('ExecutionEngineAdapter', () => {
  beforeEach(() => {
    resetGlobalRegistries();
  });

  it('routes agent_tick work items to runner path', async () => {
    const agentAService = {
      tick: jest.fn().mockResolvedValue(undefined),
    } as unknown as AgentAService;
    const runner: AgentRunner = new MarketListenerRunner(agentAService);
    const runnerRegistry = getGlobalRunnerRegistry();
    runnerRegistry.register('market_listener', runner);

    const definition = {
      id: 'agent-1',
      source: { type: 'test', path: 'agent.json' },
      config: {
        schemaVersion: 1,
        id: 'agent-1',
        name: 'Agent One',
        enabled: true,
        type: 'market_listener',
        schedule: {
          kind: 'interval',
          everyMs: 60000,
          tz: undefined,
          catchUp: {},
        },
        policy: {},
        runner: {},
      },
      markdown: '# Agent One',
      definitionHash: 'hash-1',
      status: 'valid',
      configPath: 'agent.json',
      markdownPath: 'AGENT.md',
    };
    const registry = getGlobalAgentRegistry() as unknown as { agents: Map<string, unknown> };
    registry.agents.set('agent-1', definition);

    const executionService = {
      executeWorkItem: jest.fn(),
    } as unknown as IExecutionService;
    const adapter = new ExecutionEngineAdapter(executionService);

    const workItem = createWorkItem({
      context: {
        kind: 'agent_tick',
        agent_id: 'agent-1',
        definition_hash: 'hash-1',
        run_key: 'run-1',
        scheduled_for_ms: 1700000000000,
        policy_snapshot: {},
      },
    });

    await adapter.execute(workItem, {
      model: 'test',
      laneId: 'main',
      budgetRemaining: {},
    });

    expect(agentAService.tick).toHaveBeenCalledTimes(1);
    expect(agentAService.tick).toHaveBeenCalledWith({
      run_id: 'run-1',
      now: new Date(1700000000000).toISOString(),
      max_sources_per_tick: 10,
      max_items_per_source: 50,
      default_time_window: '6h',
    });
    expect(executionService.executeWorkItem).not.toHaveBeenCalled();
  });

  it('routes non-agent_tick work items to ExecutionService', async () => {
    const executionService = {
      executeWorkItem: jest.fn().mockResolvedValue({
        run: {
          id: 'run-1',
          work_item_id: 'wi-1',
          goal_id: 'goal-1',
          agent_type: 'default',
          run_sequence: 1,
          status: 'success',
          created_at: Date.now(),
          tokens_used: 10,
          time_seconds: 1,
          cost_usd: 0.01,
          artifacts: [],
        } satisfies Run,
        success: true,
        needsRetry: false,
      }),
    } as unknown as IExecutionService;
    const adapter = new ExecutionEngineAdapter(executionService);

    const workItem = createWorkItem({ context: undefined });

    await adapter.execute(workItem, {
      model: 'test',
      laneId: 'main',
      budgetRemaining: {},
    });

    expect(executionService.executeWorkItem).toHaveBeenCalledTimes(1);
  });
});
