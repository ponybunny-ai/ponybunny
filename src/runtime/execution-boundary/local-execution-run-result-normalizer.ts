import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ExecutionResult } from '../../app/lifecycle/stage-interfaces.js';
import type {
  ExecutionRunResultNormalizer,
  ExecutionRunResultNormalizationParams,
} from './execution-run-result-normalizer.js';

export class LocalExecutionRunResultNormalizer implements ExecutionRunResultNormalizer {
  normalizeExecutionResult(
    repository: IWorkOrderRepository,
    params: ExecutionRunResultNormalizationParams
  ): ExecutionResult {
    const persistedRun = repository.getRun(params.run.id) ?? params.run;
    const needsRetry = !params.success && !this.shouldEscalateError(repository, params);
    const errorSignature = this.generateErrorSignature(params.error);

    return {
      run: persistedRun,
      success: params.success,
      needsRetry,
      errorSignature,
    };
  }

  private shouldEscalateError(
    repository: IWorkOrderRepository,
    params: ExecutionRunResultNormalizationParams
  ): boolean {
    if (params.workItemRetryCount >= params.workItemMaxRetries) {
      return true;
    }

    const repeatedErrors = repository.getRepeatedErrorSignatures(
      params.workItemId,
      params.maxConsecutiveErrors
    );

    return repeatedErrors.length > 0;
  }

  private generateErrorSignature(error?: string): string | undefined {
    if (!error) return undefined;

    const normalized = error
      .replace(/\d+/g, 'N')
      .replace(/0x[0-9a-f]+/gi, 'HEX')
      .replace(/\/[\w\/.-]+/g, 'PATH')
      .substring(0, 200);

    return this.simpleHash(normalized);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}
