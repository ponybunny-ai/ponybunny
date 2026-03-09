export interface RuntimeEvent {
  id: string;
  type: string;
  workItemId?: string;
  goalId?: string;
  runId?: string;
  source: string;
  timestamp: number;
  payload?: unknown;
}
