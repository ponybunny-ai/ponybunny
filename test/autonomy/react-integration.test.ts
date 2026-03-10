import type { ILLMProvider, LLMMessage, LLMProviderConfig, LLMResponse } from '../../src/infra/llm/llm-provider.js';
import type { Run, WorkItem } from '../../src/work-order/types/index.js';
import type { ToolEnforcer } from '../../src/infra/tools/tool-registry.js';
import type { ToolPort, ToolRequest } from '../../src/runtime/tool-boundary/index.js';
import { LocalToolWorker } from '../../src/runtime/workers/index.js';

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
      {
        content: 'Task is complete. All requirements met.',
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

    expect(result.success).toBe(true);
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(2);
    expect(result.log).toContain('Completion summary: Implemented and verified task output.');
  });

  it('uses the explicit runtime tooling context instead of global prompt/tool providers', async () => {
    const provider = createMockProvider([
      {
        content: 'Task is complete. All requirements met.',
        tokensUsed: 4,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const runtimeToolingContext = {
      getPromptProvider: () => ({
        generateExecutionPrompt: () => 'runtime system prompt',
      }),
      toolProvider: {
        getToolDefinitions: () => [
          {
            name: 'runtime_tool',
            description: 'Runtime tool',
            parameters: { type: 'object' as const, properties: {} },
          },
        ],
      },
    };

    const integration = new ReActIntegration(
      provider,
      undefined,
      undefined,
      undefined,
      runtimeToolingContext as never
    );

    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(true);
    expect(provider.complete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: 'runtime system prompt',
        }),
      ]),
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'runtime_tool',
          }),
        ],
      })
    );
  });

  it('routes authoritative tool execution through LocalToolWorker with run-scoped identity context', async () => {
    mockToolDefinitions = [
      {
        name: 'search_code',
        description: 'Search code',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
          },
          required: ['pattern'],
        },
      },
    ];

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
              name: 'search_code',
              arguments: JSON.stringify({ pattern: 'ToolPort' }),
            },
          },
        ],
      },
      {
        content: 'Task is complete. All requirements met.',
        tokensUsed: 6,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const execute = jest.fn(async (request: ToolRequest) => ({
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: true,
      output: 'search results',
    }));
    const toolPort: ToolPort = { execute };
    const toolWorker = new LocalToolWorker(toolPort);
    const dispatchSpy = jest.spyOn(toolWorker, 'dispatch');

    const integration = new ReActIntegration(provider, undefined, toolPort, toolWorker);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolRequestId: 'run-1:call-1:search_code',
        runId: 'run-1',
        workItemId: 'wi-1',
        goalId: 'goal-1',
        toolCallId: 'call-1',
        toolName: 'search_code',
        arguments: JSON.stringify({ pattern: 'ToolPort' }),
        cwd: process.cwd(),
      })
    );
    expect(result.log).toContain('Tool search_code: search results');
  });

  it('treats a mismatched toolRequestId as an invalid correlated result', async () => {
    mockToolDefinitions = [
      {
        name: 'search_code',
        description: 'Search code',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
          },
          required: ['pattern'],
        },
      },
    ];

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
              name: 'search_code',
              arguments: JSON.stringify({ pattern: 'ToolPort' }),
            },
          },
        ],
      },
      {
        content: 'Task is complete. All requirements met.',
        tokensUsed: 6,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const toolPort: ToolPort = {
      execute: jest.fn(async (request: ToolRequest) => ({
        toolRequestId: `${request.toolRequestId}:mismatch`,
        runId: request.runId,
        workItemId: request.workItemId,
        goalId: request.goalId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: true,
        output: 'search results',
      })),
    };

    const integration = new ReActIntegration(provider, undefined, toolPort);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2-codex',
    });

    expect(result.success).toBe(true);
    expect(result.log).toContain('Tool search_code: Tool execution failed: Tool result correlation mismatch');
    expect(result.log).not.toContain('Tool search_code: search results');
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

  it('fallback MCP invocation extracts concise query from mixed-language request', async () => {
    mockToolDefinitions = [
      {
        name: 'mcp__records_mcp__search_entity',
        description: 'Search entity records',
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
          if (name === 'mcp__records_mcp__search_entity') {
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
      workItem: createWorkItem({ description: '我需要darkhorseone limited公司注册信息' }),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.3',
      toolEnforcer: fakeToolEnforcer,
    });

    expect(result.success).toBe(true);
    expect(toolExecute).toHaveBeenCalled();
    expect((toolExecute.mock.calls[0]?.[0] as Record<string, unknown>)?.q).toBe('darkhorseone limited');
  });

  it('prioritizes MCP search tools before web_search for lookup intents', async () => {
    mockToolDefinitions = [
      {
        name: 'web_search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
      {
        name: 'mcp__records_mcp__search_entity',
        description: 'Search entity records',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string' },
          },
          required: ['q'],
        },
      },
    ];

    const callOrder: string[] = [];

    const fakeToolEnforcer = {
      checkToolInvocation: jest.fn(() => ({ allowed: true, requiresApproval: false })),
      registry: {
        getTool: jest.fn((name: string) => {
          if (name === 'mcp__records_mcp__search_entity') {
            return {
              execute: jest.fn(async (args: Record<string, unknown>) => {
                callOrder.push('mcp');
                return JSON.stringify({ items: [{ id: '15002342', title: 'DARKHORSEONE LIMITED' }], args });
              }),
            };
          }

          if (name === 'web_search') {
            return {
              execute: jest.fn(async () => {
                callOrder.push('web');
                return JSON.stringify({ results: [] });
              }),
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
        content: 'Company number found: 15002342',
        tokensUsed: 5,
        model: 'gpt-test',
        finishReason: 'stop',
      },
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem({ description: 'find details for Darkhorseone Limited' }),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.3',
      toolEnforcer: fakeToolEnforcer,
    });

    expect(result.success).toBe(true);
    expect(callOrder[0]).toBe('mcp');
    expect(callOrder).not.toContain('web');
  });

  it('returns successful tool output when synthesis LLM call fails', async () => {
    mockToolDefinitions = [
      {
        name: 'mcp__records_mcp__search_entity',
        description: 'Search entity records',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string' },
          },
          required: ['q'],
        },
      },
    ];

    const fakeToolEnforcer = {
      checkToolInvocation: jest.fn(() => ({ allowed: true, requiresApproval: false })),
      registry: {
        getTool: jest.fn((name: string) => {
          if (name === 'mcp__records_mcp__search_entity') {
            return {
              execute: jest.fn(async () => JSON.stringify({ items: [{ id: '15002342', title: 'Darkhorseone Limited' }] })),
            };
          }
          return undefined;
        }),
      },
      allowlist: {},
    } as unknown as ToolEnforcer;

    let llmCallCount = 0;
    const provider: ILLMProvider = {
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

        llmCallCount += 1;

        if (llmCallCount <= 2) {
          return {
            content: '',
            tokensUsed: 5,
            model: 'gpt-test',
            finishReason: 'stop' as const,
          };
        }

        throw new Error('Bad Gateway');
      }),
      getName: () => 'mock-provider',
      isAvailable: async () => true,
      estimateCost: (tokens: number) => tokens * 0.000001,
    };

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem({ description: 'find details for Darkhorseone Limited' }),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.3',
      toolEnforcer: fakeToolEnforcer,
    });

    expect(result.success).toBe(true);
    expect(result.log).toContain('15002342');
  });

  it('returns explicit no-match message without synthesis call when lookup tools return empty results', async () => {
    mockToolDefinitions = [
      {
        name: 'mcp__records_mcp__search_entity',
        description: 'Search entity records',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string' },
          },
          required: ['q'],
        },
      },
    ];

    const fakeToolEnforcer = {
      checkToolInvocation: jest.fn(() => ({ allowed: true, requiresApproval: false })),
      registry: {
        getTool: jest.fn((name: string) => {
          if (name === 'mcp__records_mcp__search_entity') {
            return {
              execute: jest.fn(async () => JSON.stringify({ items: [], total_results: 0 })),
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
    ]);

    const integration = new ReActIntegration(provider);
    const result = await integration.executeWorkCycle({
      workItem: createWorkItem({ description: '我需要darkhorseone limited公司注册信息' }),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.3',
      toolEnforcer: fakeToolEnforcer,
    });

    expect(result.success).toBe(true);
    expect(result.log).toContain('returned no matching records');
    expect((provider.complete as jest.Mock).mock.calls.length).toBe(3);
  });

  it('includes stronger local-tool routing hints in initial observation', async () => {
    mockToolDefinitions = [
      {
        name: 'mcp__records_mcp__search_entity',
        description: 'Search entity records',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
        },
      },
      {
        name: 'web_search',
        description: 'Search web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ];

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
      workItem: createWorkItem(),
      run: createRun(),
      signal: new AbortController().signal,
      model: 'gpt-5.2',
    });

    expect(result.success).toBe(true);

    const firstExecutionCallMessages = (provider.complete as jest.Mock).mock.calls[1][0] as LLMMessage[];
    const initialUserMessage = firstExecutionCallMessages.find((message) => message.role === 'user')?.content;

    expect(typeof initialUserMessage).toBe('string');
    expect(initialUserMessage).toContain('Priority: MCP/domain tools -> built-in local tools -> web_search.');
    expect(initialUserMessage).toContain('web_search is fallback only');
    expect(initialUserMessage).toContain('Tools execute in the local runtime (not by the model itself).');
  });

  it('prioritizes MCP tools in immediate action directive after non-actionable reply', async () => {
    mockToolDefinitions = [
      {
        name: 'web_search',
        description: 'Search web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
      {
        name: 'search_code',
        description: 'Search local code',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } },
        },
      },
      {
        name: 'mcp__records_mcp__search_entity',
        description: 'Search entity records',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
        },
      },
    ];

    const provider = createMockProvider([
      {
        content: 'I am still planning.',
        tokensUsed: 6,
        model: 'gpt-test',
        finishReason: 'stop',
      },
      {
        content: 'Task is complete. All requirements met.',
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
      model: 'gpt-5.2',
    });

    expect(result.success).toBe(true);

    const thirdCallMessages = (provider.complete as jest.Mock).mock.calls[2][0] as LLMMessage[];
    const directive = thirdCallMessages[thirdCallMessages.length - 1].content;

    expect(typeof directive).toBe('string');
    expect(directive).toContain('Prefer MCP/domain tools first; use web_search only as fallback.');
    expect(directive).toContain('Preferred candidates: mcp__records_mcp__search_entity, search_code, web_search');
  });
});
