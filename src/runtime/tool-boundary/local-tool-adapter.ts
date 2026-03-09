import type { ToolEnforcer } from '../../infra/tools/tool-registry.js';
import type { ToolFailure, ToolPort, ToolRequest, ToolResult } from './types.js';

export class LocalToolAdapter implements ToolPort {
  constructor(private readonly toolEnforcer: ToolEnforcer) {}

  async execute(request: ToolRequest): Promise<ToolResult> {
    const normalizedArgs = this.normalizeArguments(request);
    if ('error' in normalizedArgs) {
      return this.buildFailureResult(request, normalizedArgs.error);
    }

    const check = this.toolEnforcer.checkToolInvocation(request.toolName, normalizedArgs.arguments);
    if (!check.allowed) {
      return this.buildFailureResult(request, {
        code: 'TOOL_INVOCATION_DENIED',
        message: check.reason ?? `Tool '${request.toolName}' invocation denied`,
        recoverable: false,
      });
    }

    const tool = this.toolEnforcer.registry.getTool(request.toolName);
    if (!tool) {
      return this.buildFailureResult(request, {
        code: 'TOOL_NOT_FOUND',
        message: `Tool '${request.toolName}' not found`,
        recoverable: false,
      });
    }

    try {
      const output = await tool.execute(normalizedArgs.arguments, {
        cwd: request.cwd,
        allowlist: this.toolEnforcer.allowlist,
        enforcer: this.toolEnforcer,
      });

      return {
        toolRequestId: request.toolRequestId,
        runId: request.runId,
        workItemId: request.workItemId,
        goalId: request.goalId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        success: true,
        output,
      };
    } catch (error) {
      return this.buildFailureResult(request, {
        code: 'TOOL_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
    }
  }

  private normalizeArguments(
    request: ToolRequest
  ): { arguments: Record<string, unknown> } | { error: ToolFailure } {
    if (typeof request.arguments === 'string') {
      try {
        const parsed = JSON.parse(request.arguments) as unknown;
        if (this.isRecord(parsed)) {
          return { arguments: parsed };
        }

        return {
          error: {
            code: 'TOOL_REQUEST_INVALID',
            message: `Tool '${request.toolName}' arguments must decode to an object`,
            recoverable: false,
          },
        };
      } catch (error) {
        return {
          error: {
            code: 'TOOL_REQUEST_INVALID',
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
          },
        };
      }
    }

    if (this.isRecord(request.arguments)) {
      return { arguments: request.arguments };
    }

    return {
      error: {
        code: 'TOOL_REQUEST_INVALID',
        message: `Tool '${request.toolName}' arguments must be an object`,
        recoverable: false,
      },
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private buildFailureResult(request: ToolRequest, error: ToolFailure): ToolResult {
    return {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: false,
      error,
    };
  }
}
