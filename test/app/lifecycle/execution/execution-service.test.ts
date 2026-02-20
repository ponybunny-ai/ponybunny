import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { Goal, Run, WorkItem } from '../../../../src/work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { ILLMProvider, LLMMessage, LLMResponse, ToolCall } from '../../../../src/infra/llm/llm-provider.js';
import { ExecutionService } from '../../../../src/app/lifecycle/execution/execution-service.js';

class ScriptedWriteToolLLMProvider implements ILLMProvider {
  private callCount = 0;

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const hasToolResult = messages.some(message => message.role === 'tool');

    if (hasToolResult) {
      return {
        content: 'Task is complete',
        tokensUsed: 5,
        model: 'scripted-write-tool',
        finishReason: 'stop',
      };
    }

    const userMessage = messages.find(message => message.role === 'user');
    const isAllowRun = typeof userMessage?.content === 'string' && userMessage.content.includes('ALLOW_WRITE');

    const toolCall: ToolCall = {
      id: `tool-call-${this.callCount++}`,
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({
          path: isAllowRun
            ? '.sisyphus/evidence/task-18-concurrency-allow.txt'
            : '.sisyphus/evidence/task-18-concurrency-deny.txt',
          content: isAllowRun ? 'allow-run' : 'deny-run',
        }),
      },
    };

    return {
      content: null,
      tokensUsed: 7,
      model: 'scripted-write-tool',
      finishReason: 'tool_calls',
      toolCalls: [toolCall],
    };
  }

  getName(): string {
    return 'scripted-write-tool';
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  estimateCost(_tokens: number): number {
    return 0;
  }
}

function createGoal(goalId: string): Goal {
  const now = Date.now();
  return {
    id: goalId,
    created_at: now,
    updated_at: now,
    title: `Goal ${goalId}`,
    description: 'Test goal',
    success_criteria: [],
    status: 'active',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
  };
}

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = Date.now();
  return {
    id: overrides.id ?? `work-item-${now}`,
    created_at: now,
    updated_at: now,
    goal_id: overrides.goal_id ?? 'goal-1',
    title: overrides.title ?? 'ALLOW_WRITE default title',
    description: overrides.description ?? 'Execute write tool',
    item_type: overrides.item_type ?? 'code',
    status: overrides.status ?? 'ready',
    priority: overrides.priority ?? 1,
    dependencies: overrides.dependencies ?? [],
    blocks: overrides.blocks ?? [],
    assigned_agent: overrides.assigned_agent,
    estimated_effort: overrides.estimated_effort ?? 'S',
    retry_count: overrides.retry_count ?? 0,
    max_retries: overrides.max_retries ?? 2,
    verification_plan: overrides.verification_plan,
    verification_status: overrides.verification_status ?? 'not_started',
    context: overrides.context,
  };
}

function createRepository(goal: Goal): IWorkOrderRepository {
  const runsById = new Map<string, Run>();
  let runCounter = 0;

  const repository: Partial<IWorkOrderRepository> = {
    getGoal: jest.fn((goalId: string) => (goalId === goal.id ? goal : undefined)),
    getRunsByWorkItem: jest.fn((workItemId: string) =>
      Array.from(runsById.values()).filter(run => run.work_item_id === workItemId)
    ),
    createRun: jest.fn((params: { work_item_id: string; goal_id: string; agent_type: string; run_sequence: number }) => {
      const runId = `run-${++runCounter}`;
      const run: Run = {
        id: runId,
        created_at: Date.now(),
        work_item_id: params.work_item_id,
        goal_id: params.goal_id,
        agent_type: params.agent_type,
        run_sequence: params.run_sequence,
        status: 'running',
        tokens_used: 0,
        cost_usd: 0,
        artifacts: [],
      };
      runsById.set(runId, run);
      return run;
    }),
    completeRun: jest.fn((runId: string, params: {
      status: Run['status'];
      error_message?: string;
      tokens_used: number;
      time_seconds: number;
      cost_usd: number;
      artifacts: string[];
      execution_log?: string;
    }) => {
      const existing = runsById.get(runId);
      if (!existing) return;
      runsById.set(runId, {
        ...existing,
        status: params.status,
        error_message: params.error_message,
        tokens_used: params.tokens_used,
        time_seconds: params.time_seconds,
        cost_usd: params.cost_usd,
        artifacts: params.artifacts,
        execution_log: params.execution_log,
        completed_at: Date.now(),
      });
    }),
    getRun: jest.fn((runId: string) => runsById.get(runId)),
    createDecision: jest.fn(() => ({
      id: `decision-${Date.now()}`,
      created_at: Date.now(),
      run_id: 'run-1',
      work_item_id: 'work-item',
      goal_id: goal.id,
      decision_type: 'tool',
      decision_point: 'tool_policy_resolution',
      options_considered: [],
      selected_option: 'allowlist_only',
      reasoning: 'test',
    })),
    updateGoalSpending: jest.fn(),
    getRepeatedErrorSignatures: jest.fn(() => []),
  };

  return repository as IWorkOrderRepository;
}

describe('ExecutionService per-work-item tool allowlist', () => {
  const allowPath = '.sisyphus/evidence/task-18-concurrency-allow.txt';
  const denyPath = '.sisyphus/evidence/task-18-concurrency-deny.txt';
  const originalAutoDiscovery = process.env.PONY_SKILL_AUTO_DISCOVERY;

  beforeEach(() => {
    process.env.PONY_SKILL_AUTO_DISCOVERY = 'false';
    rmSync(allowPath, { force: true });
    rmSync(denyPath, { force: true });
  });

  afterAll(() => {
    if (originalAutoDiscovery === undefined) {
      delete process.env.PONY_SKILL_AUTO_DISCOVERY;
      return;
    }
    process.env.PONY_SKILL_AUTO_DISCOVERY = originalAutoDiscovery;
  });

  it('denies disallowed tool invocation when work item allowlist is restrictive', async () => {
    const goal = createGoal('goal-deny');
    const repository = createRepository(goal);
    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, new ScriptedWriteToolLLMProvider());

    const restrictedItem = createWorkItem({
      id: 'work-item-deny',
      goal_id: goal.id,
      title: 'DENY_WRITE restrictive run',
      context: {
        tool_allowlist: ['read_file'],
      },
    });

    const result = await service.executeWorkItem(restrictedItem);

    expect(result.success).toBe(true);
    expect(result.run.execution_log).toContain('Action denied: Tool \'write_file\' not in allowlist for this goal');
    expect(existsSync(denyPath)).toBe(false);
  });

  it('keeps tool permissions isolated across concurrent runs', async () => {
    const goal = createGoal('goal-concurrent');
    const repository = createRepository(goal);
    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, new ScriptedWriteToolLLMProvider());

    const allowRunItem = createWorkItem({
      id: 'work-item-allow',
      goal_id: goal.id,
      title: 'ALLOW_WRITE isolated run',
      context: {
        tool_allowlist: ['write_file'],
      },
    });

    const denyRunItem = createWorkItem({
      id: 'work-item-deny-2',
      goal_id: goal.id,
      title: 'DENY_WRITE isolated run',
      context: {
        tool_allowlist: ['read_file'],
      },
    });

    const [allowResult, denyResult] = await Promise.all([
      service.executeWorkItem(allowRunItem),
      service.executeWorkItem(denyRunItem),
    ]);

    expect(allowResult.success).toBe(true);
    expect(denyResult.success).toBe(true);
    expect(allowResult.run.execution_log).toContain(`Successfully wrote ${'allow-run'.length} bytes to ${allowPath}`);
    expect(allowResult.run.execution_log).not.toContain('Action denied');
    expect(denyResult.run.execution_log).toContain('Action denied: Tool \'write_file\' not in allowlist for this goal');
    expect(existsSync(allowPath)).toBe(true);
    expect(readFileSync(allowPath, 'utf-8')).toBe('allow-run');
    expect(existsSync(denyPath)).toBe(false);
  });

  it('enforces layered deny policy at execution boundary', async () => {
    const goal = createGoal('goal-layered-deny');
    const repository = createRepository(goal);
    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, new ScriptedWriteToolLLMProvider());

    const layeredDenyItem = createWorkItem({
      id: 'work-item-layered-deny',
      goal_id: goal.id,
      title: 'DENY_WRITE layered policy run',
      context: {
        tool_allowlist: ['write_file', 'read_file'],
        tool_policy: {
          global: {
            deny: ['write_file'],
          },
        },
      },
    });

    const result = await service.executeWorkItem(layeredDenyItem);

    expect(result.success).toBe(true);
    expect(result.run.execution_log).toContain('Action denied: Tool \'write_file\' denied by global deny policy');
    expect(result.run.execution_log).toContain('[POLICY_AUDIT]');
    expect(existsSync(denyPath)).toBe(false);

    const createDecisionMock = (repository as unknown as { createDecision: jest.Mock }).createDecision;
    expect(createDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_type: 'tool',
        decision_point: 'tool_policy_resolution',
        selected_option: 'layered_policy_applied',
      })
    );
  });

  it('uses routeContext provider to select tool envelope and emits policy audit metadata', async () => {
    const goal = createGoal('goal-route-context-provider');
    const repository = createRepository(goal);
    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, new ScriptedWriteToolLLMProvider());

    const providerDeniedItem = createWorkItem({
      id: 'work-item-provider-deny',
      goal_id: goal.id,
      title: 'DENY_WRITE provider constrained run',
      context: {
        tool_allowlist: ['write_file', 'read_file'],
        tool_policy: {
          byProvider: {
            'openai/gpt-5.3-codex': {
              deny: ['write_file'],
            },
          },
        },
        routeContext: {
          source: 'gateway.message',
          providerId: 'openai/gpt-5.3-codex',
        },
      },
    });

    const deniedResult = await service.executeWorkItem(providerDeniedItem);
    expect(deniedResult.success).toBe(true);
    expect(deniedResult.run.execution_log).toContain('Action denied: Tool \'write_file\' denied by provider:openai/gpt-5.3-codex deny policy');
    expect(deniedResult.run.execution_log).toContain('[ROUTE_CONTEXT] source=gateway.message provider=openai/gpt-5.3-codex');
    expect((providerDeniedItem.context as Record<string, unknown>).tool_policy_audit).toEqual(
      expect.objectContaining({
        hasLayeredPolicy: true,
        appliedLayers: expect.arrayContaining(['provider:openai/gpt-5.3-codex']),
      })
    );

    const createDecisionMock = (repository as unknown as { createDecision: jest.Mock }).createDecision;
    expect(createDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_point: 'tool_policy_resolution',
        metadata: expect.objectContaining({
          routeContext: expect.objectContaining({
            source: 'gateway.message',
            providerId: 'openai/gpt-5.3-codex',
          }),
          policyAudit: expect.objectContaining({
            hasLayeredPolicy: true,
          }),
        }),
      })
    );

    const providerAllowedItem = createWorkItem({
      id: 'work-item-provider-allow',
      goal_id: goal.id,
      title: 'ALLOW_WRITE provider unconstrained run',
      context: {
        tool_allowlist: ['write_file', 'read_file'],
        tool_policy: {
          byProvider: {
            'openai/gpt-5.3-codex': {
              deny: ['write_file'],
            },
          },
        },
        routeContext: {
          source: 'gateway.message',
          providerId: 'anthropic/claude-sonnet-4.5',
        },
      },
    });

    const allowedResult = await service.executeWorkItem(providerAllowedItem);
    expect(allowedResult.success).toBe(true);
    expect(allowedResult.run.execution_log).not.toContain('Action denied');
    expect(existsSync(allowPath)).toBe(true);
  });
});
