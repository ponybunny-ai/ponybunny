import {
  ToolRequestRegistry,
  type ToolRequest,
  type ToolResult,
} from '../../../src/runtime/tool-boundary/index.js';

describe('ToolRequestRegistry', () => {
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

  function createResult(request: ToolRequest, overrides: Partial<ToolResult> = {}): ToolResult {
    return {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: true,
      output: 'ok',
      ...overrides,
    };
  }

  it('registers one pending promise per toolRequestId and preserves request identity', () => {
    const registry = new ToolRequestRegistry();
    const request = createRequest();

    const registration = registry.register(request);

    expect(registration.kind).toBe('registered');
    expect(registry.inspect()).toEqual({
      pending: [
        expect.objectContaining({
          toolRequestId: request.toolRequestId,
          runId: request.runId,
          workItemId: request.workItemId,
          goalId: request.goalId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          state: 'pending',
          registeredAt: expect.any(Number),
        }),
      ],
      recent: [],
    });
  });

  it('returns the same promise for duplicate registration and resolves exactly once', async () => {
    const registry = new ToolRequestRegistry();
    const request = createRequest();
    const first = registry.register(request);
    const duplicate = registry.register(request);

    expect(first.kind).toBe('registered');
    expect(duplicate.kind).toBe('duplicate');
    if (first.kind !== 'registered' || duplicate.kind !== 'duplicate') {
      throw new Error('Expected successful duplicate registration flow');
    }

    expect(duplicate.promise).toBe(first.promise);

    const successResult = createResult(request);
    expect(first.owner.resolveSuccess(successResult)).toBe(true);
    expect(first.owner.resolveFailure(createResult(request, {
      success: false,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'late completion',
        recoverable: true,
      },
    }))).toBe(false);

    await expect(first.promise).resolves.toEqual(successResult);
    expect(registry.inspect()).toEqual({
      pending: [],
      recent: [
        expect.objectContaining({
          toolRequestId: request.toolRequestId,
          state: 'resolved',
          terminal: expect.objectContaining({
            outcome: 'success',
            success: true,
            ignoredCompletionCount: 1,
          }),
        }),
      ],
    });
  });

  it('rejects conflicting identity reuse for the same toolRequestId', () => {
    const registry = new ToolRequestRegistry();
    const request = createRequest();

    registry.register(request);
    const conflict = registry.register(createRequest({
      runId: 'run-2',
    }));

    expect(conflict.kind).toBe('conflict');
    expect(conflict.entry).toEqual(expect.objectContaining({
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
    }));
  });
});
