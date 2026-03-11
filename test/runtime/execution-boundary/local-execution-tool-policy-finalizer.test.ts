import { LocalExecutionToolPolicyFinalizer } from '../../../src/runtime/execution-boundary/local-execution-tool-policy-finalizer.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { ToolPolicyAuditSnapshot } from '../../../src/infra/tools/tool-registry.js';
import type { Run, WorkItem } from '../../../src/work-order/types/index.js';

function createRun(): Run {
  return {
    id: 'run-finalizer-1',
    created_at: Date.now(),
    work_item_id: 'wi-finalizer-1',
    goal_id: 'goal-finalizer-1',
    agent_type: 'default',
    run_sequence: 1,
    status: 'success',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
  };
}

function createWorkItem(): WorkItem {
  return {
    id: 'wi-finalizer-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-finalizer-1',
    title: 'Finalize tool policy outcome',
    description: 'Persist the policy decision and annotate logs',
    item_type: 'analysis',
    status: 'ready',
    priority: 1,
    dependencies: [],
    blocks: [],
    estimated_effort: 'S',
    retry_count: 0,
    max_retries: 1,
    verification_status: 'not_started',
  };
}

describe('LocalExecutionToolPolicyFinalizer', () => {
  it('preserves post-cycle policy log decoration and decision persistence semantics', () => {
    const finalizer = new LocalExecutionToolPolicyFinalizer();
    const policyAudit: ToolPolicyAuditSnapshot = {
      baselineAllowedTools: ['read_file', 'write_file'],
      effectiveAllowedTools: ['read_file'],
      deniedTools: [{ tool: 'write_file', reason: 'global deny policy' }],
      appliedLayers: ['global'],
      policyContext: {
        providerId: 'openai/gpt-5.3-codex',
      },
      hasLayeredPolicy: true,
    };

    const executionLog = finalizer.buildExecutionLog({
      executionLog: 'tool execution trace',
      policyAudit,
      routeContext: {
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
        channel: 'rpc',
        senderIsOwner: false,
        sandboxed: false,
      },
    });

    expect(executionLog).toContain('[POLICY_AUDIT]');
    expect(executionLog).toContain('[ROUTE_CONTEXT] source=gateway.message provider=openai/gpt-5.3-codex');
    expect(executionLog).toContain('tool execution trace');

    const repository = {
      createDecision: jest.fn(() => ({})),
    } as unknown as IWorkOrderRepository;

    finalizer.persistDecision(repository, {
      run: createRun(),
      workItem: createWorkItem(),
      policyAudit,
      routeContext: {
        source: 'gateway.message',
        providerId: 'openai/gpt-5.3-codex',
      },
    });

    expect(repository.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_type: 'tool',
        decision_point: 'tool_policy_resolution',
        selected_option: 'layered_policy_applied',
        metadata: expect.objectContaining({
          policyAudit,
          routeContext: expect.objectContaining({
            providerId: 'openai/gpt-5.3-codex',
          }),
        }),
      })
    );
  });

  it('skips decision persistence when no policy audit exists', () => {
    const finalizer = new LocalExecutionToolPolicyFinalizer();
    const repository = {
      createDecision: jest.fn(),
    } as unknown as IWorkOrderRepository;

    finalizer.persistDecision(repository, {
      run: createRun(),
      workItem: createWorkItem(),
      routeContext: {
        source: 'gateway.message',
      },
    });

    expect(repository.createDecision).not.toHaveBeenCalled();
  });
});
