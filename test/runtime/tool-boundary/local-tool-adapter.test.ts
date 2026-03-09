import {
  LocalToolAdapter,
  formatToolResultForModel,
  type ToolRequest,
} from '../../../src/runtime/tool-boundary/index.js';
import {
  ToolAllowlist,
  ToolEnforcer,
  ToolRegistry,
  type ToolDefinition,
} from '../../../src/infra/tools/tool-registry.js';

describe('LocalToolAdapter', () => {
  function createRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
    return {
      toolRequestId: 'run-1:call-1:test_tool',
      runId: 'run-1',
      workItemId: 'wi-1',
      goalId: 'goal-1',
      toolCallId: 'call-1',
      toolName: 'test_tool',
      arguments: { value: 1 },
      cwd: '/tmp/project',
      ...overrides,
    };
  }

  function createTool(name: string, execute: ToolDefinition['execute']): ToolDefinition {
    return {
      name,
      category: 'code',
      riskLevel: 'safe',
      requiresApproval: false,
      description: `${name} tool`,
      execute,
    };
  }

  it('normalizes local tool success through ToolResult', async () => {
    const registry = new ToolRegistry();
    registry.register(createTool('test_tool', async (args, context) => {
      expect(args).toEqual({ value: 1 });
      expect(context.cwd).toBe('/tmp/project');
      return 'ok';
    }));

    const allowlist = new ToolAllowlist(['test_tool']);
    const adapter = new LocalToolAdapter(new ToolEnforcer(registry, allowlist));

    const result = await adapter.execute(createRequest());

    expect(result).toEqual({
      toolRequestId: 'run-1:call-1:test_tool',
      runId: 'run-1',
      workItemId: 'wi-1',
      goalId: 'goal-1',
      toolCallId: 'call-1',
      toolName: 'test_tool',
      success: true,
      output: 'ok',
    });
    expect(formatToolResultForModel(result)).toBe('ok');
  });

  it('normalizes invalid requests and execution failures through ToolResult', async () => {
    const registry = new ToolRegistry();
    registry.register(createTool('test_tool', async () => {
      throw new Error('boom');
    }));

    const allowlist = new ToolAllowlist(['test_tool']);
    const adapter = new LocalToolAdapter(new ToolEnforcer(registry, allowlist));

    const invalidRequest = await adapter.execute(createRequest({
      arguments: '{"broken"',
    }));
    expect(invalidRequest.success).toBe(false);
    expect(invalidRequest.error).toEqual({
      code: 'TOOL_REQUEST_INVALID',
      message: expect.any(String),
      recoverable: false,
    });
    expect(formatToolResultForModel(invalidRequest)).toContain('Error:');

    const failedExecution = await adapter.execute(createRequest());
    expect(failedExecution.success).toBe(false);
    expect(failedExecution.error).toEqual({
      code: 'TOOL_EXECUTION_FAILED',
      message: 'boom',
      recoverable: true,
    });
    expect(formatToolResultForModel(failedExecution)).toBe('Tool execution failed: boom');
  });

  it('executes MCP-backed registry tools through the same boundary', async () => {
    const registry = new ToolRegistry();
    const mcpExecute = jest.fn(async (args: Record<string, unknown>) => JSON.stringify({
      items: [{ id: '15002342' }],
      args,
    }));
    registry.register(createTool('mcp__records_mcp__search_entity', mcpExecute));

    const allowlist = new ToolAllowlist(['mcp__records_mcp__search_entity']);
    const adapter = new LocalToolAdapter(new ToolEnforcer(registry, allowlist));

    const result = await adapter.execute(createRequest({
      toolRequestId: 'run-1:call-2:mcp__records_mcp__search_entity',
      toolCallId: 'call-2',
      toolName: 'mcp__records_mcp__search_entity',
      arguments: JSON.stringify({ q: 'Darkhorseone Limited' }),
    }));

    expect(result.success).toBe(true);
    expect(mcpExecute).toHaveBeenCalledWith(
      { q: 'Darkhorseone Limited' },
      expect.objectContaining({ cwd: '/tmp/project' })
    );
    expect(result.output).toContain('15002342');
  });
});
