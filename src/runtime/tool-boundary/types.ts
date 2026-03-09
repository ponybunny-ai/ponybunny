export interface ToolFailure {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface ToolRequest {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId?: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  cwd: string;
  routeContext?: unknown;
}

export interface ToolResult {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId?: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  output?: string;
  error?: ToolFailure;
}

export interface ToolPort {
  execute(request: ToolRequest): Promise<ToolResult>;
}

export function formatToolResultForModel(result: ToolResult): string {
  if (result.success) {
    return result.output ?? '';
  }

  const error = result.error;
  if (!error) {
    return 'Tool execution failed: Unknown error';
  }

  switch (error.code) {
    case 'TOOL_INVOCATION_DENIED':
      return `Action denied: ${error.message}`;
    case 'TOOL_NOT_FOUND':
      return `Error: ${error.message}`;
    case 'TOOL_REQUEST_INVALID':
      return `Error: ${error.message}`;
    default:
      return `Tool execution failed: ${error.message}`;
  }
}
