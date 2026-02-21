import type { ILLMProvider, LLMMessage, LLMProviderConfig, LLMResponse } from '../../src/infra/llm/llm-provider.js';
import type { Run, WorkItem } from '../../src/work-order/types/index.js';
import type { ToolEnforcer } from '../../src/infra/tools/tool-registry.js';

const mockGenerateExecutionPrompt = jest.fn(() => 'system prompt');
let mockToolDefinitions: Array<{
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}> = [];

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
    getToolDefinitions() {
      return mockToolDefinitions;
    }
  }

  return {
    ToolProvider: MockToolProvider,
    getGlobalToolProvider: () => ({
      getToolDefinitions: () => mockToolDefinitions,
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
    complete: jest.fn(async (messages: LLMMessage[], options?: Partial<LLMProviderConfig>) => {
      const isIntentClassification =
        options?.tool_choice === 'none' &&
        messages.length === 1 &&
        messages[0].role === 'user' &&
        typeof messages[0].content === 'string' &&
        messages[0].content.includes('Classify the task intent');

      if (isIntentClassification) {
        return {
          content: JSON.stringify({ kind: 'tool_task', rationale: 'test classification' }),
          tokensUsed: 1,
          model: 'gpt-test',
          finishReason: 'stop' as const,
        };
      }

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
    mockToolDefinitions = [];
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
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(3);
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
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(2);
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
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(4);
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
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(3);
  });

  it('forces required tool choice after an empty response', async () => {
    mockToolDefinitions = [
      {
        name: 'search_code',
        description: 'Search code',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
          },
        },
      },
    ];

    const provider = createMockProvider([
      {
        content: '',
        tokensUsed: 5,
        model: 'gpt-test',
        finishReason: 'stop',
      },
      {
        content: 'Task is complete. All requirements met.',
        tokensUsed: 5,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2',
    });

    const calls = (provider.complete as jest.Mock).mock.calls;
    expect(calls[0][1]?.tool_choice).toBe('none');
    expect(calls[1][1]?.tool_choice).toBe('auto');
    expect(calls[2][1]?.tool_choice).toBe('required');
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

  it('fallback MCP invocation prefers q and ignores JSON validation errors', async () => {
    mockToolDefinitions = [
      {
        name: 'mcp__companies_house_mcp__search_company',
        description: 'Search Companies House records',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string' },
          },
          required: ['q'],
        },
      },
    ];

    const toolExecute = jest.fn(async (args: Record<string, unknown>) => {
      if (typeof args.q === 'string' && args.q.length > 0) {
        return JSON.stringify({
          items: [{ company_number: '01234567', title: 'Darkhorseone Limited' }],
        });
      }

      return JSON.stringify({
        statusCode: 400,
        code: 'FST_ERR_VALIDATION',
        error: 'Bad Request',
        message: "querystring must have required property 'q'",
      });
    });

    const fakeToolEnforcer = {
      checkToolInvocation: jest.fn(() => ({ allowed: true, requiresApproval: false })),
      registry: {
        getTool: jest.fn((name: string) => {
          if (name === 'mcp__companies_house_mcp__search_company') {
            return {
              execute: toolExecute,
            };
          }
          return undefined;
        }),
      },
      allowlist: {},
    } as unknown as ToolEnforcer;

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
      {
        content: 'Found Darkhorseone Limited with company number 01234567.',
        tokensUsed: 5,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem({ description: 'get company information of Darkhorseone Limited' }),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.3',
      toolEnforcer: fakeToolEnforcer,
    });

    expect(result.success).toBe(true);
    expect(toolExecute).toHaveBeenCalled();
    expect((toolExecute.mock.calls[0]?.[0] as Record<string, unknown>)?.q).toBe('Darkhorseone Limited');
  });
});
