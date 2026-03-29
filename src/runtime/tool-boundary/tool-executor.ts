/**
 * ToolExecutor — risk-level-based timeout and AbortController wrapper.
 *
 * Wraps an underlying ToolPort to add:
 *   - Per-risk-level timeout enforcement via AbortController
 *   - Timeout reporting as structured ToolResult (not thrown errors)
 *   - Configurable timeout values
 *
 * This prevents unbounded tool execution (e.g. a runaway shell command)
 * from blocking the entire ReAct loop indefinitely.
 */

import type { ToolPort, ToolRequest, ToolResult } from './types.js';

export type RiskLevel = 'safe' | 'moderate' | 'dangerous';

export interface ToolTimeoutConfig {
  /** Timeout for safe tools (read_file, search). Default: 10_000ms */
  safe: number;
  /** Timeout for moderate tools (write_file). Default: 30_000ms */
  moderate: number;
  /** Timeout for dangerous tools (execute_command). Default: 60_000ms */
  dangerous: number;
}

export const DEFAULT_TOOL_TIMEOUT_CONFIG: ToolTimeoutConfig = {
  safe: 10_000,
  moderate: 30_000,
  dangerous: 60_000,
};

export interface ToolRiskResolver {
  /** Resolve the risk level for a tool by name. */
  getRiskLevel(toolName: string): RiskLevel;
}

/**
 * Simple default resolver that treats all tools as moderate.
 * Replace with ToolRegistry-backed resolver in production wiring.
 */
export const DEFAULT_RISK_RESOLVER: ToolRiskResolver = {
  getRiskLevel(_toolName: string): RiskLevel {
    return 'moderate';
  },
};

export class ToolExecutor implements ToolPort {
  constructor(
    private readonly inner: ToolPort,
    private readonly riskResolver: ToolRiskResolver = DEFAULT_RISK_RESOLVER,
    private readonly config: ToolTimeoutConfig = DEFAULT_TOOL_TIMEOUT_CONFIG,
  ) {}

  async execute(request: ToolRequest): Promise<ToolResult> {
    const riskLevel = this.riskResolver.getRiskLevel(request.toolName);
    const timeoutMs = this.config[riskLevel];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race([
        this.inner.execute(request),
        this.createTimeoutPromise(controller.signal, timeoutMs, request),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private createTimeoutPromise(
    signal: AbortSignal,
    timeoutMs: number,
    request: ToolRequest
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      signal.addEventListener('abort', () => {
        resolve({
          toolRequestId: request.toolRequestId,
          runId: request.runId,
          workItemId: request.workItemId,
          goalId: request.goalId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          success: false,
          error: {
            code: 'TOOL_TIMEOUT',
            message: `Tool '${request.toolName}' timed out after ${timeoutMs}ms`,
            recoverable: true,
          },
        });
      }, { once: true });
    });
  }
}
