import type { CompleteRunParams, IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import { materializeCompatibilityRunModelProjection } from '../../infra/llm/provider-manager/model-selection-compatibility.js';
import type {
  ExecutionGoalSpendingUpdateParams,
  ExecutionRunCompletionFinalizer,
  ExecutionRunCompletionParams,
} from './execution-run-completion-finalizer.js';

export class LocalExecutionRunCompletionFinalizer implements ExecutionRunCompletionFinalizer {
  buildRunCompletion(params: ExecutionRunCompletionParams): CompleteRunParams {
    const { executionResult, executionLog, timeSeconds, selectedModel, requestedModel } = params;
    const compatibilityProjection = materializeCompatibilityRunModelProjection({
      selectedModel,
      actualModel: executionResult.actualModel,
    });

    return {
      status: executionResult.success ? 'success' : 'failure',
      error_message: executionResult.error,
      tokens_used: executionResult.tokensUsed,
      time_seconds: timeSeconds,
      cost_usd: executionResult.costUsd,
      artifacts: executionResult.artifactIds || [],
      execution_log: executionLog,
      context: {
        selected_model: compatibilityProjection.selected_model,
        requested_model: requestedModel,
        actual_model: compatibilityProjection.actual_model,
        endpoint_id: executionResult.endpointId,
      },
    };
  }

  persistGoalSpending(
    repository: IWorkOrderRepository,
    params: ExecutionGoalSpendingUpdateParams
  ): void {
    try {
      repository.updateGoalSpending(
        params.goalId,
        params.tokensUsed,
        Math.ceil(params.timeSeconds / 60),
        params.costUsd
      );
    } catch (error) {
      console.warn('[ExecutionService] Failed to update goal spending after run completion:', error);
    }
  }
}
