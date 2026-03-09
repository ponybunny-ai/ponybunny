import type { WorkItem } from '../../work-order/types/index.js';

export interface ExecutionRequest {
  runId: string;
  goalId: string;
  workItemId: string;
  workItem: WorkItem;
  model: string;
  laneId: string;
  budgetRemaining: unknown;
}

export interface ExecutionResult {
  runId: string;
  workItemId: string;
  success: boolean;
  tokensUsed: number;
  timeSeconds: number;
  costUsd: number;
  artifacts: string[];
  actualModel?: string;
  endpointId?: string;
  error?: { code: string; message: string; recoverable: boolean };
}

export interface ExecutionPort {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  abort(runId: string): Promise<void>;
}
