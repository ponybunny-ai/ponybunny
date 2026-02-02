import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IEvaluationService, EvaluationResult, VerificationResult } from '../stage-interfaces.js';

export class EvaluationService implements IEvaluationService {
  constructor(
    private repository: IWorkOrderRepository
  ) {}

  async evaluateRun(
    workItem: WorkItem,
    run: Run,
    verification: VerificationResult
  ): Promise<EvaluationResult> {
    if (run.status === 'success' && verification.passed) {
      return {
        decision: 'publish',
        reasoning: 'Execution successful and all quality gates passed',
        nextActions: ['mark_work_item_done', 'unblock_dependents', 'check_goal_completion'],
      };
    }

    if (run.status === 'success' && !verification.passed) {
      if (this.canRetry(workItem)) {
        return {
          decision: 'retry',
          reasoning: `Quality gates failed: ${verification.failureReason}. Retrying (${workItem.retry_count + 1}/${workItem.max_retries})`,
          nextActions: ['increment_retry_count', 'mark_ready'],
        };
      }

      return {
        decision: 'escalate',
        reasoning: `Quality gates failed after ${workItem.max_retries} retries: ${verification.failureReason}`,
        nextActions: ['create_escalation', 'mark_blocked'],
      };
    }

    if (run.status === 'failure') {
      const repeatedErrors = this.repository.getRepeatedErrorSignatures(
        workItem.id,
        3
      );

      if (repeatedErrors.length > 0) {
        return {
          decision: 'escalate',
          reasoning: `Repeated error pattern detected (${repeatedErrors[0]})`,
          nextActions: ['create_escalation', 'mark_blocked'],
        };
      }

      if (this.canRetry(workItem)) {
        return {
          decision: 'retry',
          reasoning: `Execution failed: ${run.error_message}. Retrying (${workItem.retry_count + 1}/${workItem.max_retries})`,
          nextActions: ['increment_retry_count', 'mark_ready'],
        };
      }

      return {
        decision: 'escalate',
        reasoning: `Execution failed after ${workItem.max_retries} retries: ${run.error_message}`,
        nextActions: ['create_escalation', 'mark_blocked'],
      };
    }

    return {
      decision: 'escalate',
      reasoning: `Unexpected run status: ${run.status}`,
      nextActions: ['create_escalation', 'mark_blocked'],
    };
  }

  private canRetry(workItem: WorkItem): boolean {
    return workItem.retry_count < workItem.max_retries;
  }
}
