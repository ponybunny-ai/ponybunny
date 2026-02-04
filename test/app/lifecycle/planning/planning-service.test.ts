import { jest } from '@jest/globals';
import { PlanningService } from '../../../../src/app/lifecycle/planning/planning-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { ILLMProvider, LLMResponse } from '../../../../src/infra/llm/llm-provider.js';
import type { Goal, WorkItem } from '../../../../src/work-order/types/index.js';

describe('PlanningService', () => {
  let service: PlanningService;
  let mockRepo: {
    getReadyWorkItems: jest.Mock;
    createWorkItem: jest.Mock;
  };
  let mockLLM: {
    complete: jest.Mock<any>;
  };

  const mockGoal: Goal = {
    id: 'goal-123',
    title: 'Test Goal',
    description: 'A test goal',
    status: 'queued',
    created_at: Date.now(),
    updated_at: Date.now(),
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    success_criteria: [],
    priority: 50,
  };

  beforeEach(() => {
    mockRepo = {
      getReadyWorkItems: jest.fn(),
      createWorkItem: jest.fn(),
    };
    
    mockLLM = {
      complete: jest.fn(),
    };

    service = new PlanningService(
      mockRepo as unknown as IWorkOrderRepository, 
      mockLLM as unknown as ILLMProvider
    );
  });

  test('should return existing items if already planned', async () => {
    const existingItems: WorkItem[] = [{
      id: 'wi-1',
      goal_id: 'goal-123',
      title: 'Existing Item',
      dependencies: [],
    } as any];

    mockRepo.getReadyWorkItems.mockReturnValue(existingItems);

    const result = await service.planWorkItems(mockGoal);

    expect(result.workItems).toEqual(existingItems);
    expect(mockLLM.complete).not.toHaveBeenCalled();
  });

  test('should call LLM and create work items for new plan', async () => {
    mockRepo.getReadyWorkItems.mockReturnValue([]);
    
    const mockPlan = [
      {
        id: 'temp-1',
        title: 'Task A',
        description: 'Do A',
        item_type: 'code',
        priority: 80,
        estimated_effort: 'S',
        dependencies: [],
        verification_plan: { quality_gates: [], acceptance_criteria: [] }
      },
      {
        id: 'temp-2',
        title: 'Task B',
        description: 'Do B',
        item_type: 'test',
        priority: 70,
        estimated_effort: 'M',
        dependencies: ['temp-1'],
        verification_plan: { quality_gates: [], acceptance_criteria: [] }
      }
    ];

    mockLLM.complete.mockResolvedValue({
      content: JSON.stringify(mockPlan),
      tokensUsed: 100,
      model: 'test-model',
      finishReason: 'stop'
    } as any);

    mockRepo.createWorkItem.mockImplementation((params: any) => ({
      id: `real-${params.title === 'Task A' ? '1' : '2'}`,
      ...params,
    }));

    const result = await service.planWorkItems(mockGoal);

    expect(mockLLM.complete).toHaveBeenCalled();
    expect(mockRepo.createWorkItem).toHaveBeenCalledTimes(2);
    
    const call2 = mockRepo.createWorkItem.mock.calls[1][0] as any;
    expect(call2.title).toBe('Task B');
    expect(call2.dependencies).toEqual(['real-1']);
    
    expect(result.workItems).toHaveLength(2);
  });

  test('should detect cyclic dependencies', async () => {
    mockRepo.getReadyWorkItems.mockReturnValue([]);

    const mockPlan = [
      {
        id: 'temp-1',
        title: 'Task A',
        dependencies: ['temp-2'],
        description: 'A',
        item_type: 'code',
        priority: 50,
        estimated_effort: 'S',
        verification_plan: { quality_gates: [], acceptance_criteria: [] }
      },
      {
        id: 'temp-2',
        title: 'Task B',
        dependencies: ['temp-1'],
        description: 'B',
        item_type: 'code',
        priority: 50,
        estimated_effort: 'S',
        verification_plan: { quality_gates: [], acceptance_criteria: [] }
      }
    ];

    mockLLM.complete.mockResolvedValue({
      content: JSON.stringify(mockPlan),
      tokensUsed: 100,
      model: 'test-model',
      finishReason: 'stop'
    } as any);

    await expect(service.planWorkItems(mockGoal))
      .rejects
      .toThrow(/Cyclic dependency/);
  });
});
