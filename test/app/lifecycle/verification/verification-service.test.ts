import { jest } from '@jest/globals';
import { VerificationService } from '../../../../src/app/lifecycle/verification/verification-service.js';
import type { ILLMProvider, LLMResponse } from '../../../../src/infra/llm/llm-provider.js';
import type { WorkItem, Run } from '../../../../src/work-order/types/index.js';

describe('VerificationService', () => {
  let service: VerificationService;
  let mockLLM: {
    complete: jest.Mock<any>;
  };

  const mockWorkItem: WorkItem = {
    id: 'wi-1',
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'A test task',
    item_type: 'code',
    status: 'verify',
    priority: 50,
    dependencies: [],
    blocks: [],
    estimated_effort: 'S',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    created_at: Date.now(),
    updated_at: Date.now(),
    verification_plan: {
      quality_gates: [],
      acceptance_criteria: []
    }
  };

  const mockRun: Run = {
    id: 'run-1',
    created_at: Date.now(),
    work_item_id: 'wi-1',
    goal_id: 'goal-1',
    agent_type: 'default',
    run_sequence: 1,
    status: 'success',
    tokens_used: 100,
    cost_usd: 0.01,
    artifacts: [],
    execution_log: 'Executed command: echo "hello"\nSuccess.'
  };

  beforeEach(() => {
    mockLLM = {
      complete: jest.fn(),
    };
    service = new VerificationService(mockLLM as unknown as ILLMProvider);
  });

  test('should pass if verification plan is missing', async () => {
    const item = { ...mockWorkItem, verification_plan: undefined };
    const result = await service.verifyWorkItem(item, mockRun);
    expect(result.passed).toBe(true);
  });

  test('should execute deterministic gates', async () => {
    const item = {
      ...mockWorkItem,
      verification_plan: {
        quality_gates: [
          {
            name: 'echo test',
            type: 'deterministic' as const,
            command: 'echo "test"',
            required: true,
            expected_exit_code: 0
          }
        ],
        acceptance_criteria: []
      }
    };

    const result = await service.verifyWorkItem(item, mockRun);
    expect(result.passed).toBe(true);
    expect(result.gateResults[0].output).toContain('test');
  });

  test('should execute llm_review gates', async () => {
    const item = {
      ...mockWorkItem,
      verification_plan: {
        quality_gates: [
          {
            name: 'code review',
            type: 'llm_review' as const,
            review_prompt: 'Check for bugs',
            required: true
          }
        ],
        acceptance_criteria: []
      }
    };

    mockLLM.complete.mockResolvedValue({
      content: JSON.stringify({ passed: true, reasoning: 'Looks good' }),
      tokensUsed: 50,
      model: 'gpt-4o',
      finishReason: 'stop'
    } as any);

    const result = await service.verifyWorkItem(item, mockRun);
    
    expect(mockLLM.complete).toHaveBeenCalled();
    expect(result.passed).toBe(true);
    expect(result.gateResults[0].type).toBe('llm_review');
    expect(result.gateResults[0].output).toBe('Looks good');
  });

  test('should fail if llm_review rejects', async () => {
    const item = {
      ...mockWorkItem,
      verification_plan: {
        quality_gates: [
          {
            name: 'security check',
            type: 'llm_review' as const,
            review_prompt: 'Check for leaks',
            required: true
          }
        ],
        acceptance_criteria: []
      }
    };

    mockLLM.complete.mockResolvedValue({
      content: JSON.stringify({ passed: false, reasoning: 'Found a leak' }),
      tokensUsed: 50,
      model: 'gpt-4o',
      finishReason: 'stop'
    } as any);

    const result = await service.verifyWorkItem(item, mockRun);
    
    expect(result.passed).toBe(false);
    expect(result.failureReason).toContain('Found a leak');
  });
});
