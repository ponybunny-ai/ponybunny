import { jest } from '@jest/globals';
import { ElaborationService } from '../../../../src/app/lifecycle/elaboration/elaboration-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { Goal } from '../../../../src/work-order/types/index.js';
import type { GlobalKnowledgeService, GlobalKnowledge } from '../../../../src/domain/knowledge/global-knowledge-service.js';

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

  test('should include global knowledge pitfalls in clarifications when service is provided', async () => {
    const mockPitfalls: GlobalKnowledge[] = [
      {
        id: 'k-1',
        created_at: Date.now(),
        source_goal_id: 'old-goal',
        source_context_pack_id: null,
        knowledge_type: 'pitfall',
        domain_tags: [],
        content: 'Always verify services are wired into all execution paths',
        confidence: 0.8,
        occurrence_count: 3,
        last_reinforced_at: Date.now(),
      },
      {
        id: 'k-2',
        created_at: Date.now(),
        source_goal_id: 'old-goal-2',
        source_context_pack_id: null,
        knowledge_type: 'pitfall',
        domain_tags: [],
        content: 'Never skip hook verification',
        confidence: 0.6,
        occurrence_count: 1,
        last_reinforced_at: Date.now(),
      },
    ];

    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue(mockPitfalls),
    };

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    const goal = makeGoal();
    const result = await service.elaborateGoal(goal);

    // Should have exactly one clarification entry containing the pitfalls
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0]).toContain('2 relevant pitfall(s)');
    expect(result.clarifications[0]).toContain('Always verify services are wired into all execution paths');
    expect(result.clarifications[0]).toContain('Never skip hook verification');
    expect(result.clarifications[0]).toContain('[Known pitfall, confidence 0.8]');
    expect(result.clarifications[0]).toContain('[Known pitfall, confidence 0.6]');
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

  test('should query pitfalls with minimum confidence 0.4', async () => {
    const mockKnowledge = {
      getRelevantKnowledge: jest.fn().mockReturnValue([]),
    };

    const service = new ElaborationService(
      mockRepo as unknown as IWorkOrderRepository,
      mockKnowledge as unknown as GlobalKnowledgeService,
    );

    await service.elaborateGoal(makeGoal());

    expect(mockKnowledge.getRelevantKnowledge).toHaveBeenCalledWith({
      knowledgeType: 'pitfall',
      limit: 5,
      minConfidence: 0.4,
    });
  });
});
