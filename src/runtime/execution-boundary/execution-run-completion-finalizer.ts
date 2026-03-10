import type { CompleteRunParams, IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ExecutionCycleResult } from './execution-cycle-runner.js';

export interface ExecutionRunCompletionParams {
  executionResult: ExecutionCycleResult;
  executionLog: string;
  timeSeconds: number;
  selectedModel?: unknown;
  requestedModel?: unknown;
}

export interface ExecutionGoalSpendingUpdateParams {
  goalId: string;
  tokensUsed: number;
  timeSeconds: number;
  costUsd: number;
}

export interface ExecutionRunCompletionFinalizer {
  buildRunCompletion(params: ExecutionRunCompletionParams): CompleteRunParams;
  persistGoalSpending(
    repository: IWorkOrderRepository,
    params: ExecutionGoalSpendingUpdateParams
  ): void;
}
