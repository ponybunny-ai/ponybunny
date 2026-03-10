import { ExecutionService } from '../../../../src/app/lifecycle/execution/execution-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { ExecutionResourcePreparer } from '../../../../src/runtime/execution-boundary/index.js';
import type { WorkItem } from '../../../../src/work-order/types/index.js';

function createWorkItem(): WorkItem {
  return {
    id: 'wi-resource-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-resource-1',
    title: 'Select best integration',
    description: 'Pick the best MCP and skill for GitHub repository search',
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
      policy_snapshot: {
        skills: {
          available: ['*'],
          denied: [],
        },
        mcp: {
          available: ['*'],
          denied: [],
        },
      },
      tool_allowlist: ['read_file', 'search_code'],
    },
  };
}

describe('ExecutionService resource selection narrowing', () => {
  const originalAutoDiscovery = process.env.PONY_SKILL_AUTO_DISCOVERY;

  beforeEach(() => {
    process.env.PONY_SKILL_AUTO_DISCOVERY = 'false';
  });

  afterAll(() => {
    if (originalAutoDiscovery === undefined) {
      delete process.env.PONY_SKILL_AUTO_DISCOVERY;
      return;
    }
    process.env.PONY_SKILL_AUTO_DISCOVERY = originalAutoDiscovery;
  });

  it('escalates when resource candidates are too broad and needs user narrowing', async () => {
    const runRecord = {
      id: 'run-resource-1',
      work_item_id: 'wi-resource-1',
      goal_id: 'goal-resource-1',
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
      createDecision: jest.fn(() => ({})),
      updateGoalSpending: jest.fn(),
    } as unknown as IWorkOrderRepository;

    const executionResourcePreparer: ExecutionResourcePreparer = {
      prepareForWorkItem: jest.fn().mockResolvedValue({
        blocked: true,
        reason:
          'Too many resource candidates. Provide selected_skill_override or selected_mcp_tool_override via escalation response data. '
          + 'skills=[github-search, gitlab-search, repo-discovery, org-auditor], mcp=[none]',
      }),
    };
    const service = new ExecutionService(repository, { maxConsecutiveErrors: 3 }, undefined, {
      executionResourcePreparer,
    });

    const result = await service.executeWorkItem(createWorkItem());

    expect(result.success).toBe(false);
    expect(result.needsRetry).toBe(false);
    expect(executionResourcePreparer.prepareForWorkItem).toHaveBeenCalled();
    expect(repository.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        work_item_id: 'wi-resource-1',
        goal_id: 'goal-resource-1',
        escalation_type: 'ambiguous',
        title: 'Need narrowing for skill/MCP/tool selection',
      })
    );
    expect(repository.completeRun).toHaveBeenCalledWith(
      'run-resource-1',
      expect.objectContaining({ status: 'failure' })
    );
  });
});
