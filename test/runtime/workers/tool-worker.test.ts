import { MemoryEventBus } from '../../../src/runtime/event-bus/index.js';
import type { ToolPort, ToolRequest, ToolResult } from '../../../src/runtime/tool-boundary/index.js';
import { LocalToolAdapter } from '../../../src/runtime/tool-boundary/index.js';
import {
  LocalToolWorker,
  TOOL_WORKER_SOURCE,
} from '../../../src/runtime/workers/index.js';
import {
  ToolAllowlist,
  ToolEnforcer,
  ToolRegistry,
  type ToolDefinition,
} from '../../../src/infra/tools/tool-registry.js';

describe('LocalToolWorker', () => {
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

  let bus: MemoryEventBus;
  let events: Array<{
    type: string;
    source: string;
    runId?: string;
    goalId?: string;
    workItemId?: string;
    toolRequestId?: string;
    toolCallId?: string;
    toolName?: string;
    payload?: unknown;
  }>;

  beforeEach(() => {
    bus = new MemoryEventBus();
    events = [];
    bus.subscribeAll((event) => {
      events.push({
        type: event.type,
        source: event.source,
        runId: event.runId,
        goalId: event.goalId,
        workItemId: event.workItemId,
        toolRequestId: event.toolRequestId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        payload: event.payload,
      });
    });
  });

  it('receives a ToolRequest and emits requested, started, and completed on success', async () => {
    const request = createRequest();
    const result: ToolResult = {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: true,
      output: 'ok',
    };
    const toolPort: ToolPort = {
      execute: jest.fn().mockResolvedValue(result),
    };
    const worker = new LocalToolWorker(toolPort, bus);

    await expect(worker.dispatch(request)).resolves.toEqual(result);

    expect(toolPort.execute).toHaveBeenCalledWith(request);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.requested',
        source: TOOL_WORKER_SOURCE,
        runId: request.runId,
        goalId: request.goalId,
        workItemId: request.workItemId,
        toolRequestId: request.toolRequestId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        payload: {
          request,
          context: {
            toolRequestId: request.toolRequestId,
            runId: request.runId,
            workItemId: request.workItemId,
            goalId: request.goalId,
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            source: TOOL_WORKER_SOURCE,
          },
        },
      }),
      expect.objectContaining({
        type: 'tool.started',
        source: TOOL_WORKER_SOURCE,
      }),
      expect.objectContaining({
        type: 'tool.completed',
        source: TOOL_WORKER_SOURCE,
        payload: {
          request,
          result,
          context: {
            toolRequestId: request.toolRequestId,
            runId: request.runId,
            workItemId: request.workItemId,
            goalId: request.goalId,
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            source: TOOL_WORKER_SOURCE,
          },
        },
      }),
    ]));
  });

  it('emits tool.failed when ToolPort returns an unsuccessful result', async () => {
    const request = createRequest();
    const result: ToolResult = {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: false,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'boom',
        recoverable: true,
      },
    };
    const worker = new LocalToolWorker({
      execute: jest.fn().mockResolvedValue(result),
    }, bus);

    await expect(worker.dispatch(request)).resolves.toEqual(result);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.failed',
        source: TOOL_WORKER_SOURCE,
        runId: request.runId,
        goalId: request.goalId,
        workItemId: request.workItemId,
        toolRequestId: request.toolRequestId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        payload: {
          request,
          result,
          error: {
            code: 'TOOL_EXECUTION_FAILED',
            message: 'boom',
            recoverable: true,
          },
          context: {
            toolRequestId: request.toolRequestId,
            runId: request.runId,
            workItemId: request.workItemId,
            goalId: request.goalId,
            toolCallId: request.toolCallId,
            toolName: request.toolName,
            source: TOOL_WORKER_SOURCE,
          },
        },
      }),
    ]));
  });

  it('emits tool.failed with a normalized worker exception result on throw', async () => {
    const request = createRequest();
    const worker = new LocalToolWorker({
      execute: jest.fn().mockRejectedValue(new Error('worker blew up')),
    }, bus);

    await expect(worker.dispatch(request)).resolves.toEqual({
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: false,
      error: {
        code: 'TOOL_WORKER_EXCEPTION',
        message: 'worker blew up',
        recoverable: true,
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.failed',
        source: TOOL_WORKER_SOURCE,
      }),
    ]));
  });

  it('suppresses duplicate in-process requests by toolRequestId', async () => {
    const request = createRequest();
    let resolveResult: (result: ToolResult) => void = () => undefined;
    const resultPromise = new Promise<ToolResult>((resolve) => {
      resolveResult = resolve;
    });
    const toolPort: ToolPort = {
      execute: jest.fn().mockReturnValue(resultPromise),
    };
    const worker = new LocalToolWorker(toolPort, bus);

    const first = worker.dispatch(request);
    const second = worker.dispatch(request);

    resolveResult({
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: true,
      output: 'ok',
    });

    await expect(first).resolves.toEqual(await second);
    expect(toolPort.execute).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'tool.requested')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(1);
  });

  it('remains compatible with local and MCP-backed tools through the same ToolPort boundary', async () => {
    const registry = new ToolRegistry();
    const localExecute = jest.fn(async () => 'local-ok');
    const mcpExecute = jest.fn(async (args: Record<string, unknown>) => JSON.stringify({
      items: [{ id: '15002342' }],
      args,
    }));
    registry.register(createTool('test_tool', localExecute));
    registry.register(createTool('mcp__records_mcp__search_entity', mcpExecute));

    const allowlist = new ToolAllowlist(['test_tool', 'mcp__records_mcp__search_entity']);
    const worker = new LocalToolWorker(
      new LocalToolAdapter(new ToolEnforcer(registry, allowlist)),
      bus
    );

    const localResult = await worker.dispatch(createRequest());
    const mcpResult = await worker.dispatch(createRequest({
      toolRequestId: 'run-1:call-2:mcp__records_mcp__search_entity',
      toolCallId: 'call-2',
      toolName: 'mcp__records_mcp__search_entity',
      arguments: JSON.stringify({ q: 'Darkhorseone Limited' }),
    }));

    expect(localResult).toEqual(expect.objectContaining({
      success: true,
      output: 'local-ok',
    }));
    expect(mcpResult).toEqual(expect.objectContaining({
      success: true,
      output: expect.stringContaining('15002342'),
    }));
    expect(localExecute).toHaveBeenCalled();
    expect(mcpExecute).toHaveBeenCalledWith(
      { q: 'Darkhorseone Limited' },
      expect.objectContaining({ cwd: '/tmp/project' })
    );
  });
});
