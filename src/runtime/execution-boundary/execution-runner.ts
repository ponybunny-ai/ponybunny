import type { WorkItem } from '../../work-order/types/index.js';

export interface RuntimeExecutionRunSummary {
  tokens_used: number;
  time_seconds?: number;
  cost_usd: number;
  artifacts: string[];
  context?: Record<string, unknown>;
  error_message?: string;
}

export interface ExecutionRunnerResult {
  run: RuntimeExecutionRunSummary;
  success: boolean;
  needsRetry: boolean;
  errorSignature?: string;
}

export interface ExecutionRunner {
  executeWorkItem(workItem: WorkItem): Promise<ExecutionRunnerResult>;
}
