import type { WorkItem } from '../../work-order/types/index.js';

export interface ExecutionError {
  code: string;
  message: string;
  recoverable: boolean;
}

export type ExecutionOutcome = 'success' | 'failure';

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
  goalId?: string;
  workItemId: string;
  source?: string;
  success: boolean;
  outcome?: ExecutionOutcome;
  tokensUsed: number;
  timeSeconds: number;
  costUsd: number;
  artifacts: string[];
  actualModel?: string;
  endpointId?: string;
  error?: ExecutionError;
}

export interface FailedExecutionResult extends ExecutionResult {
  success: false;
  outcome: 'failure';
  error: ExecutionError;
}

export interface ExecutionPort {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  abort(runId: string): Promise<void>;
}
