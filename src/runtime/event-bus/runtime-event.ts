export interface RuntimeEvent {
  id: string;
  type: string;
  taskId?: string;
  goalId?: string;
  runId?: string;
  source: string;
  timestamp: number;
  payload?: unknown;
}
