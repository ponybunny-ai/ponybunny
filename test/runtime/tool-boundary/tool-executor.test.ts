import {
  ToolExecutor,
  DEFAULT_TOOL_TIMEOUT_CONFIG,
} from '../../../src/runtime/tool-boundary/tool-executor.js';
import type { ToolPort, ToolRequest, ToolResult } from '../../../src/runtime/tool-boundary/types.js';
import type { RiskLevel, ToolRiskResolver } from '../../../src/runtime/tool-boundary/tool-executor.js';

function makeRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    toolRequestId: 'req-1',
    runId: 'run-1',
    workItemId: 'wi-1',
    goalId: 'goal-1',
    toolCallId: 'tc-1',
    toolName: 'test_tool',
    arguments: {},
    cwd: '/tmp',
    ...overrides,
  };
}

function makeResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolRequestId: 'req-1',
    runId: 'run-1',
    workItemId: 'wi-1',
    goalId: 'goal-1',
    toolCallId: 'tc-1',
    toolName: 'test_tool',
    success: true,
    output: 'OK',
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  describe('timeout enforcement', () => {
    it('returns tool result when execution completes within timeout', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockResolvedValue(makeResult()),
      };
      const executor = new ToolExecutor(inner);

      const result = await executor.execute(makeRequest());
      expect(result.success).toBe(true);
      expect(result.output).toBe('OK');
    });

    it('returns timeout error when execution exceeds timeout', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(makeResult()), 500))
        ),
      };

      const executor = new ToolExecutor(
        inner,
        { getRiskLevel: () => 'safe' },
        { safe: 50, moderate: 50, dangerous: 50 }
      );

      const result = await executor.execute(makeRequest({ toolName: 'slow_tool' }));

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_TIMEOUT');
      expect(result.error?.message).toContain('slow_tool');
      expect(result.error?.message).toContain('50ms');
      expect(result.error?.recoverable).toBe(true);
    });

    it('preserves request identifiers in timeout result', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(makeResult()), 500))
        ),
      };

      const request = makeRequest({
        toolRequestId: 'req-42',
        runId: 'run-7',
        workItemId: 'wi-99',
        goalId: 'goal-5',
        toolCallId: 'tc-3',
        toolName: 'stuck_tool',
      });

      const executor = new ToolExecutor(
        inner,
        { getRiskLevel: () => 'safe' },
        { safe: 10, moderate: 10, dangerous: 10 }
      );

      const result = await executor.execute(request);

      expect(result.toolRequestId).toBe('req-42');
      expect(result.runId).toBe('run-7');
      expect(result.workItemId).toBe('wi-99');
      expect(result.goalId).toBe('goal-5');
      expect(result.toolCallId).toBe('tc-3');
      expect(result.toolName).toBe('stuck_tool');
    });
  });

  describe('risk-level-based timeouts', () => {
    it('uses safe timeout for safe tools', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(makeResult()), 200))
        ),
      };

      const riskResolver: ToolRiskResolver = {
        getRiskLevel: (name: string) => (name === 'read_file' ? 'safe' : 'moderate'),
      };

      const executor = new ToolExecutor(
        inner,
        riskResolver,
        { safe: 50, moderate: 500, dangerous: 1000 }
      );

      // Safe tool with 200ms execution vs 50ms timeout → should timeout
      const result = await executor.execute(makeRequest({ toolName: 'read_file' }));
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_TIMEOUT');
    });

    it('uses dangerous timeout for dangerous tools', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(makeResult()), 50))
        ),
      };

      const riskResolver: ToolRiskResolver = {
        getRiskLevel: () => 'dangerous' as RiskLevel,
      };

      const executor = new ToolExecutor(
        inner,
        riskResolver,
        { safe: 10, moderate: 10, dangerous: 200 }
      );

      // Dangerous tool with 50ms execution vs 200ms timeout → should succeed
      const result = await executor.execute(makeRequest({ toolName: 'execute_command' }));
      expect(result.success).toBe(true);
    });
  });

  describe('defaults', () => {
    it('has sensible default timeout values', () => {
      expect(DEFAULT_TOOL_TIMEOUT_CONFIG.safe).toBe(10_000);
      expect(DEFAULT_TOOL_TIMEOUT_CONFIG.moderate).toBe(30_000);
      expect(DEFAULT_TOOL_TIMEOUT_CONFIG.dangerous).toBe(60_000);
    });

    it('defaults to moderate risk when no resolver is provided', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockResolvedValue(makeResult()),
      };

      const executor = new ToolExecutor(inner);
      const result = await executor.execute(makeRequest());
      expect(result.success).toBe(true);
    });
  });

  describe('error propagation', () => {
    it('propagates inner tool errors as-is', async () => {
      const inner: ToolPort = {
        execute: jest.fn().mockResolvedValue(makeResult({
          success: false,
          error: { code: 'TOOL_NOT_FOUND', message: 'No such tool', recoverable: false },
        })),
      };

      const executor = new ToolExecutor(inner);
      const result = await executor.execute(makeRequest());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TOOL_NOT_FOUND');
    });
  });
});
