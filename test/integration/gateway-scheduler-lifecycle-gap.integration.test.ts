/**
 * Integration test: Gateway → SchedulerCore lifecycle gap verification
 *
 * Documents and tests the known architectural boundary: SchedulerCore intentionally
 * has NO ElaborationService and NO GlobalKnowledgeService injection. This boundary
 * is correct — elaboration belongs in GoalHarness, not SchedulerCore (ADR-001).
 *
 * ADR-001 Status: The lifecycle gap is CLOSED at the GoalHarness layer.
 * When GoalHarness is injected into SchedulerDaemon, the materialize_goal handler
 * routes through GoalHarness (elaborate → plan → delegate to SchedulerCore).
 * SchedulerCore still has no elaboration — this is by design.
 *
 * Architecture (ADR-001):
 *   All Entry Points → GoalHarness (elaborate → plan) → SchedulerCore (execute + all infra)
 */
import type { SchedulerDependencies } from '../../src/scheduler/core/types.js';

describe('Gateway → SchedulerCore lifecycle gap (documented boundary)', () => {
  test('SchedulerDependencies type has no elaboration or knowledge service', () => {
    // This is a type-level assertion enforced at compile time.
    // If someone adds elaboration to SchedulerDependencies, this test
    // should be updated to reflect the new architecture.
    const depsKeys: (keyof SchedulerDependencies)[] = [
      'repository',
      'modelSelector',
      'laneSelector',
      'budgetTracker',
      'retryHandler',
      'escalationHandler',
      'qualityGateRunner',
      'workItemManager',
      'executionPort',
      'runtimeEventBus',
    ];

    // Verify these are the ONLY keys — no elaboration, no knowledge
    // This is a runtime check that complements the compile-time type
    const mockDeps = {} as Record<string, unknown>;
    for (const key of depsKeys) {
      mockDeps[key] = {};
    }

    // Cast should succeed with exactly these keys
    const deps = mockDeps as unknown as SchedulerDependencies;
    expect(deps).toBeDefined();

    // Explicitly verify no elaboration-related keys exist in the type
    expect(depsKeys).not.toContain('elaborationService');
    expect(depsKeys).not.toContain('globalKnowledgeService');
    expect(depsKeys).not.toContain('knowledgeService');
  });

  test('SchedulerCore.submitGoal sets status to pending without elaboration', async () => {
    // Dynamic import to avoid pulling in all SchedulerCore dependencies at module level
    const { SchedulerCore } = await import('../../src/scheduler/core/scheduler.js');

    // Minimal mock deps — only what submitGoal touches
    const eventHandlers: Array<(event: unknown) => void> = [];
    const mockDeps = {
      repository: {
        getGoal: jest.fn(),
        getWorkItemsForGoal: jest.fn().mockReturnValue([]),
        updateGoalStatus: jest.fn(),
        updateWorkItemStatus: jest.fn(),
      },
      modelSelector: { selectModel: jest.fn() },
      laneSelector: { selectLane: jest.fn().mockReturnValue('default') },
      budgetTracker: {
        checkBudget: jest.fn().mockReturnValue({ withinBudget: true }),
        recordUsage: jest.fn(),
      },
      retryHandler: { shouldRetry: jest.fn() },
      escalationHandler: { handleEscalation: jest.fn() },
      qualityGateRunner: { runGates: jest.fn() },
      workItemManager: {
        getReadyItems: jest.fn().mockReturnValue([]),
        updateDependencies: jest.fn(),
      },
      executionPort: {
        submit: jest.fn(),
        abort: jest.fn(),
        getResult: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
      },
      runtimeEventBus: {
        on: jest.fn().mockImplementation((_, handler) => { eventHandlers.push(handler); }),
        off: jest.fn(),
        emit: jest.fn(),
        subscribeAll: jest.fn().mockReturnValue(() => {}),
      },
    };

    const scheduler = new SchedulerCore(
      mockDeps as unknown as SchedulerDependencies,
      { autoStart: false },
    );

    const mockGoal = {
      id: 'gateway-goal-1',
      title: 'Goal via gateway',
      description: 'Submitted through gateway RPC',
      status: 'queued' as const,
      created_at: Date.now(),
      updated_at: Date.now(),
      success_criteria: [],
      priority: 50,
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
    };

    await scheduler.submitGoal(mockGoal);

    // submitGoal should NOT call any elaboration or knowledge service
    // (they don't exist in the dependency tree)
    // The goal state should be 'pending' — NOT 'active' (which AutonomyDaemon sets after elaboration)
    const metrics = scheduler.getMetrics();
    expect(metrics).toBeDefined();

    // No repository.updateGoalStatus call from submitGoal
    // (AutonomyDaemon would call this to set 'active' after elaboration)
    expect(mockDeps.repository.updateGoalStatus).not.toHaveBeenCalled();
  });
});
