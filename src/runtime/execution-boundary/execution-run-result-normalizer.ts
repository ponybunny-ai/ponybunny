import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { Run } from '../../work-order/types/index.js';
import type { ExecutionResult } from '../../app/lifecycle/stage-interfaces.js';

export interface ExecutionRunResultNormalizationParams {
  run: Run;
  workItemId: string;
  workItemRetryCount: number;
  workItemMaxRetries: number;
  success: boolean;
  error?: string;
  maxConsecutiveErrors: number;
}

export interface ExecutionRunResultNormalizer {
  normalizeExecutionResult(
    repository: IWorkOrderRepository,
    params: ExecutionRunResultNormalizationParams
  ): ExecutionResult;
}
