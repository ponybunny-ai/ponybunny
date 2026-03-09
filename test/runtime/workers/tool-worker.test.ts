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
          inspection: expect.objectContaining({
            toolRequestId: request.toolRequestId,
            outcome: 'in_flight',
            correlationMatched: true,
            duplicateSuppressed: false,
            duplicateDispatchCount: 0,
          }),
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
          inspection: expect.objectContaining({
            toolRequestId: request.toolRequestId,
            outcome: 'success',
            correlationMatched: true,
            duplicateSuppressed: false,
            duplicateDispatchCount: 0,
          }),
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
          inspection: expect.objectContaining({
            toolRequestId: request.toolRequestId,
            outcome: 'failure',
            correlationMatched: true,
            failureCode: 'TOOL_EXECUTION_FAILED',
          }),
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

  it('normalizes a mismatched correlated identity into a failed invalid ToolResult', async () => {
    const request = createRequest();
    const worker = new LocalToolWorker({
      execute: jest.fn().mockResolvedValue({
        toolRequestId: request.toolRequestId,
        runId: `${request.runId}:mismatch`,
        workItemId: request.workItemId,
        goalId: request.goalId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: true,
        output: 'ok',
      }),
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
        code: 'TOOL_RESULT_MISMATCH',
        message: expect.stringContaining(request.runId),
        recoverable: false,
      },
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.failed',
        source: TOOL_WORKER_SOURCE,
        toolRequestId: request.toolRequestId,
      }),
    ]));
  });

  it('normalizes missing identity context into a failed invalid ToolResult without executing the port', async () => {
    const request = createRequest({
      toolRequestId: '',
      runId: '',
      toolCallId: '',
    });
    const toolPort: ToolPort = {
      execute: jest.fn(),
    };
    const worker = new LocalToolWorker(toolPort, bus);

    await expect(worker.dispatch(request)).resolves.toEqual({
      toolRequestId: '',
      runId: '',
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: '',
      toolName: request.toolName,
      success: false,
      error: {
        code: 'TOOL_REQUEST_INVALID',
        message: 'Invalid tool request identity context: missing toolRequestId, runId, toolCallId',
        recoverable: false,
      },
    });

    expect(toolPort.execute).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.failed',
        source: TOOL_WORKER_SOURCE,
        payload: expect.objectContaining({
          inspection: expect.objectContaining({
            outcome: 'invalid',
            correlationMatched: false,
            failureCode: 'TOOL_REQUEST_INVALID',
          }),
        }),
      }),
    ]));
  });

  it('normalizes failed results that omit an error payload', async () => {
    const request = createRequest();
    const worker = new LocalToolWorker({
      execute: jest.fn().mockResolvedValue({
        toolRequestId: request.toolRequestId,
        runId: request.runId,
        workItemId: request.workItemId,
        goalId: request.goalId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: false,
      }),
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
        code: 'TOOL_RESULT_INVALID',
        message: `Tool '${request.toolName}' returned a failed result without an error payload`,
        recoverable: false,
      },
    });
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
    expect(worker.inspect()).toEqual({
      inFlight: [],
      recent: [
        expect.objectContaining({
          toolRequestId: request.toolRequestId,
          outcome: 'success',
          duplicateSuppressed: true,
          duplicateDispatchCount: 1,
          correlationMatched: true,
        }),
      ],
    });
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

  it('reports recent local ToolWorker diagnostics through inspect()', async () => {
    const firstRequest = createRequest();
    const secondRequest = createRequest({
      toolRequestId: 'run-1:call-2:test_tool',
      toolCallId: 'call-2',
    });

    const worker = new LocalToolWorker({
      execute: jest.fn()
        .mockResolvedValueOnce({
          toolRequestId: firstRequest.toolRequestId,
          runId: firstRequest.runId,
          workItemId: firstRequest.workItemId,
          goalId: firstRequest.goalId,
          toolCallId: firstRequest.toolCallId,
          toolName: firstRequest.toolName,
          success: true,
          output: 'ok',
        })
        .mockResolvedValueOnce({
          toolRequestId: secondRequest.toolRequestId,
          runId: secondRequest.runId,
          workItemId: secondRequest.workItemId,
          goalId: secondRequest.goalId,
          toolCallId: secondRequest.toolCallId,
          toolName: secondRequest.toolName,
          success: false,
          error: {
            code: 'TOOL_EXECUTION_FAILED',
            message: 'broken',
            recoverable: true,
          },
        }),
    }, bus);

    await worker.dispatch(firstRequest);
    await worker.dispatch(secondRequest);

    expect(worker.inspect()).toEqual({
      inFlight: [],
      recent: [
        expect.objectContaining({
          toolRequestId: firstRequest.toolRequestId,
          runId: firstRequest.runId,
          workItemId: firstRequest.workItemId,
          toolCallId: firstRequest.toolCallId,
          toolName: firstRequest.toolName,
          outcome: 'success',
          correlationMatched: true,
          duplicateSuppressed: false,
        }),
        expect.objectContaining({
          toolRequestId: secondRequest.toolRequestId,
          runId: secondRequest.runId,
          workItemId: secondRequest.workItemId,
          toolCallId: secondRequest.toolCallId,
          toolName: secondRequest.toolName,
          outcome: 'failure',
          correlationMatched: true,
          failureCode: 'TOOL_EXECUTION_FAILED',
          failureMessage: 'broken',
        }),
      ],
    });
  });
});
