export interface RuntimeEvent {
  id: string;
  type: string;
  workItemId?: string;
  goalId?: string;
  runId?: string;
  toolRequestId?: string;
  toolCallId?: string;
  toolName?: string;
  source: string;
  timestamp: number;
  payload?: unknown;
}
