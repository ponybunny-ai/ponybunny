import type { ILLMProvider, LLMMessage, LLMProviderConfig, LLMResponse } from '../../src/infra/llm/llm-provider.js';
import type { Run, WorkItem } from '../../src/work-order/types/index.js';

const mockGenerateExecutionPrompt = jest.fn(() => 'system prompt');

jest.mock('../../src/infra/prompts/prompt-provider.js', () => ({
  getGlobalPromptProvider: () => ({
    generateExecutionPrompt: mockGenerateExecutionPrompt,
  }),
}));

jest.mock('../../src/infra/skills/skill-registry.js', () => ({
  getGlobalSkillRegistry: () => ({
    getSkillsForPhase: () => [],
  }),
}));

jest.mock('../../src/infra/tools/tool-provider.js', () => {
  class MockToolProvider {
    getToolDefinitions(): [] {
      return [];
    }
  }

  return {
    ToolProvider: MockToolProvider,
    getGlobalToolProvider: () => ({
      getToolDefinitions: () => [],
    }),
  };
});

import { ReActIntegration } from '../../src/autonomy/react-integration.js';

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'Execute a multi-step task',
    item_type: 'code',
    status: 'in_progress',
    priority: 10,
    dependencies: [],
    blocks: [],
    estimated_effort: 'S',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    ...overrides,
  };
}

function createRun(): Run {
  return {
    id: 'run-1',
    created_at: Date.now(),
    work_item_id: 'wi-1',
    goal_id: 'goal-1',
    agent_type: 'default',
    run_sequence: 1,
    status: 'running',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
    context: {},
  };
}

function createMockProvider(responses: LLMResponse[]): ILLMProvider {
  const queue = [...responses];

  return {
    complete: jest.fn(async (_messages: LLMMessage[], _options?: Partial<LLMProviderConfig>) => {
      const next = queue.shift();
      if (!next) {
        throw new Error('No mock response left');
      }
      return next;
    }),
    getName: () => 'mock-provider',
    isAvailable: async () => true,
    estimateCost: (tokens: number) => tokens * 0.000001,
  };
}

describe('ReActIntegration', () => {
  beforeEach(() => {
    mockGenerateExecutionPrompt.mockClear();
  });

  it('continues to next turn after non-complete response without tool calls', async () => {
    const provider = createMockProvider([
      {
        content: 'I am analyzing the task now.',
        tokensUsed: 10,
        model: 'gpt-test',
        finishReason: 'stop',
      },
      {
        content: 'Task is complete. All requirements met.',
        tokensUsed: 12,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(true);
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(2);
  });

  it('marks execution complete when complete_task tool is called', async () => {
    const provider = createMockProvider([
      {
        content: null,
        tokensUsed: 8,
        model: 'gpt-test',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'complete_task',
              arguments: JSON.stringify({ summary: 'Implemented and verified task output.' }),
            },
          },
        ],
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(true);
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(1);
    expect(result.log).toContain('Completion summary: Implemented and verified task output.');
  });

  it('fails after repeated non-actionable responses', async () => {
    const provider = createMockProvider([
      {
        content: 'Still thinking through the approach.',
        tokensUsed: 6,
        model: 'gpt-test',
        finishReason: 'stop',
      },
      {
        content: 'Analyzing more details.',
        tokensUsed: 6,
        model: 'gpt-test',
        finishReason: 'stop',
      },
      {
        content: 'No concrete action yet.',
        tokensUsed: 6,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no actionable tool calls after 3 attempts');
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(3);
  });

  it('fails quickly after repeated empty responses without tool calls', async () => {
    const provider = createMockProvider([
      {
        content: '',
        tokensUsed: 5,
        model: 'gpt-test',
        finishReason: 'stop',
      },
      {
        content: '',
        tokensUsed: 5,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('repeated empty model responses without tool calls');
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(2);
  });

  it('records runtime envelope audit with route context in execution log', async () => {
    const provider = createMockProvider([
      {
        content: 'Task is complete. All requirements met.',
        tokensUsed: 8,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem({
        context: {
          routeContext: {
            source: 'gateway.message',
            providerId: 'openai/gpt-5.3-codex',
            channel: 'telegram',
            senderIsOwner: false,
          },
        },
      }),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(true);
    expect(result.log).toContain('Runtime envelope selected:');
    expect(result.log).toContain('provider:openai/gpt-5.3-codex');
    expect(result.log).toContain('channel:telegram');
  });
});
