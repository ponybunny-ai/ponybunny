import { jest } from '@jest/globals';
import { ElaborationService } from '../../../../src/app/lifecycle/elaboration/elaboration-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { Goal } from '../../../../src/work-order/types/index.js';
import type { GlobalKnowledgeService, GlobalKnowledge } from '../../../../src/domain/knowledge/global-knowledge-service.js';
import type { GoalIntent } from '../../../../src/domain/work-order/types/goal-intent.js';

describe('ElaborationService', () => {
  let mockRepo: {
    updateGoalStatus: jest.Mock;
    createEscalation: jest.Mock;
    getGoal: jest.Mock;
  };

  const makeGoal = (overrides?: Partial<Goal>): Goal => ({
    id: 'goal-123',
    title: 'Test Goal',
    description: 'A sufficiently long goal description that exceeds the fifty character minimum threshold for elaboration',
    status: 'queued',
    created_at: Date.now(),
    updated_at: Date.now(),
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    success_criteria: [
      {
        description: 'Tests pass',
        type: 'deterministic',
        verification_method: 'npm test',
        required: true,
      },
    ],
    priority: 50,
    budget_tokens: 100000,
    ...overrides,
  });

  beforeEach(() => {
    mockRepo = {
      updateGoalStatus: jest.fn(),
      createEscalation: jest.fn(),
      getGoal: jest.fn(),
    };
  });

  test('should return clarifications without global knowledge when service not provided', async () => {
    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
    );

    const goal = makeGoal();
    const result = await service.elaborateGoal(goal);

    expect(result.goal).toEqual(goal);
    expect(result.escalations).toHaveLength(0);
    expect(result.clarifications).toHaveLength(0);
    // Goal should be marked active when no escalations and no clarifications
    expect(mockRepo.updateGoalStatus).toHaveBeenCalledWith('goal-123', 'active');
  });

  test('should include structured global knowledge in clarifications when service is provided', async () => {
    const mockKnowledgeEntries: GlobalKnowledge[] = [
      {
        id: 'k-1',
        created_at: Date.now(),
        source_goal_id: 'old-goal',
        source_context_pack_id: null,
        knowledge_type: 'pitfall',
        domain_tags: [],
        scope: null,
        content: 'Always verify services are wired into all execution paths',
        confidence: 0.8,
        occurrence_count: 3,
        last_reinforced_at: Date.now(),
        decayed_at: null,
      },
      {
        id: 'k-2',
        created_at: Date.now(),
        source_goal_id: 'old-goal-2',
        source_context_pack_id: null,
        knowledge_type: 'constraint',
        domain_tags: [],
        scope: null,
        content: 'GitHub API rate limit 5000 req/hr',
        confidence: 0.9,
        occurrence_count: 1,
        last_reinforced_at: Date.now(),
        decayed_at: null,
      },
    ];

    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue(mockKnowledgeEntries),
    };

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const goal = makeGoal();
    const result = await service.elaborateGoal(goal);

    // Should have one clarification entry with structured knowledge block
    const knowledgeBlock = result.clarifications.find(c => c.startsWith('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('[PITFALL] Always verify services are wired into all execution paths (confidence: 0.8)');
    expect(knowledgeBlock).toContain('[CONSTRAINT] GitHub API rate limit 5000 req/hr (confidence: 0.9)');
    expect(result.escalations).toHaveLength(0);
  });

  test('should gracefully handle GlobalKnowledgeService errors', async () => {
    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockImplementation(() => {
        throw new Error('global_knowledge table does not exist');
      }),
    };

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const goal = makeGoal();
    const result = await service.elaborateGoal(goal);

    // Should succeed without pitfall clarifications despite the error
    expect(result.escalations).toHaveLength(0);
    expect(result.clarifications).toHaveLength(0);
    expect(mockRepo.updateGoalStatus).toHaveBeenCalledWith('goal-123', 'active');
  });

  test('should query knowledge with type array and minConfidence 0.5', async () => {
    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue([]),
    };

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    await service.elaborateGoal(makeGoal());

    // Should query with structured type array for knowledge injection
    expect(mockKnowledge.getRelevantKnowledge).toHaveBeenCalledWith({
      knowledgeType: ['pitfall', 'constraint', 'failure_mode'],
      limit: 10,
      minConfidence: 0.5,
    });
  });

  test('should inject structured constraint block when GoalIntent has constraints', async () => {
    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue([]),
    };

    const intent: GoalIntent = {
      task_type: 'code_implementation',
      domain_tags: ['payments'],
      extracted_constraints: [
        { description: 'Do not modify shared API types', type: 'must_not_break', confidence: 0.85 },
        { description: 'Only PaymentService, not PaymentModule', type: 'scope_limit', confidence: 0.90 },
      ],
      scope_boundary: 'PaymentService only, not PaymentModule',
      classification_confidence: 0.9,
    };

    const goal = makeGoal({
      context: { intent },
    });

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const result = await service.elaborateGoal(goal);

    const constraintBlock = result.clarifications.find(c => c.startsWith('TASK CONSTRAINTS'));
    expect(constraintBlock).toBeDefined();
    expect(constraintBlock).toContain('[must_not_break] Do not modify shared API types (confidence: 0.85)');
    expect(constraintBlock).toContain('[scope_limit] Only PaymentService, not PaymentModule (confidence: 0.90)');
    expect(constraintBlock).toContain('SCOPE BOUNDARY:');
    expect(constraintBlock).toContain('PaymentService only, not PaymentModule');
  });

  test('should not inject constraint block when GoalIntent has no constraints', async () => {
    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue([]),
    };

    const intent: GoalIntent = {
      task_type: 'code_implementation',
      domain_tags: ['payments'],
      extracted_constraints: [],
      scope_boundary: '',
      classification_confidence: 0.9,
    };

    const goal = makeGoal({
      context: { intent },
    });

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const result = await service.elaborateGoal(goal);

    const constraintBlock = result.clarifications.find(c => c.startsWith('TASK CONSTRAINTS'));
    expect(constraintBlock).toBeUndefined();
  });

  test('should add budget suggestion when budget_tokens is not set', async () => {
    const mockEstimates: GlobalKnowledge[] = [
      {
        id: 'k-est-1',
        created_at: Date.now(),
        source_goal_id: 'old-goal',
        source_context_pack_id: null,
        knowledge_type: 'time_estimate',
        domain_tags: [],
        scope: null,
        content: '50000 tokens for similar refactoring task',
        confidence: 0.7,
        occurrence_count: 2,
        last_reinforced_at: Date.now(),
        decayed_at: null,
      },
    ];

    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockImplementation((opts: any) => {
        if (opts.knowledgeType === 'time_estimate') {
          return mockEstimates;
        }
        return [];
      }),
    };

    const goal = makeGoal({
      budget_tokens: undefined,
    });

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const result = await service.elaborateGoal(goal);

    const budgetSuggestion = result.clarifications.find(c => c.startsWith('Budget suggestion'));
    expect(budgetSuggestion).toBeDefined();
    expect(budgetSuggestion).toContain('50000 tokens for similar refactoring task');
    // It should NOT be in escalations
    expect(result.escalations.find(e => e.includes('Budget'))).toBeUndefined();
  });

  test('should skip budget suggestion when budget_tokens is already set', async () => {
    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue([]),
    };

    const goal = makeGoal({
      budget_tokens: 100000,
    });

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const result = await service.elaborateGoal(goal);

    const budgetSuggestion = result.clarifications.find(c => c.startsWith('Budget suggestion'));
    expect(budgetSuggestion).toBeUndefined();

    // Should not query for time_estimate at all
    const timeEstimateCall = mockKnowledge.getRelevantKnowledge.mock.calls.find(
      (call: any[]) => call[0]?.knowledgeType === 'time_estimate'
    );
    expect(timeEstimateCall).toBeUndefined();
  });
});
