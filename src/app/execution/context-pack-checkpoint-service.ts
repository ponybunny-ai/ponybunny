/**
 * ContextPack Checkpoint Service
 *
 * Creates ContextPack snapshots at work-item boundaries (success/failure)
 * so that subsequent planning and elaboration phases have incremental
 * knowledge about what has already happened during goal execution.
 *
 * Key invariants:
 * - All checkpoint writes are fire-and-forget — failures NEVER block the scheduler tick.
 * - knowledge_base entries are capped at MAX_KNOWLEDGE_BASE_ENTRIES per pack.
 * - PostGoalEvaluator does NOT call this service — it has its own ContextPack path.
 */

import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type {
  Goal,
  WorkItem,
  Run,
  ContextSnapshot,
} from '../../work-order/types/index.js';
import type { ILogger } from '../../infra/observability/logger.js';

const MAX_KNOWLEDGE_BASE_ENTRIES = 50;

export interface IContextPackCheckpointService {
  /**
   * Create a daily_checkpoint ContextPack after a work item reaches a terminal state.
   * Summarises the full goal execution state so far.
   */
  checkpointAfterWorkItem(
    goal: Goal,
    completedWorkItem: WorkItem,
    finalRun: Run | undefined,
  ): Promise<void>;

  /**
   * Create an error_recovery ContextPack focused on a specific error.
   */
  checkpointOnError(
    goal: Goal,
    workItem: WorkItem,
    run: Run,
    errorCode: string,
  ): Promise<void>;
}

/**
 * Default no-op implementation used when no checkpoint service is injected.
 * Ensures backward compatibility for all existing SchedulerCore consumers.
 */
export class NoopContextPackCheckpointService implements IContextPackCheckpointService {
  async checkpointAfterWorkItem(
    _goal: Goal,
    _completedWorkItem: WorkItem,
    _finalRun: Run | undefined,
  ): Promise<void> {}
  async checkpointOnError(
    _goal: Goal,
    _workItem: WorkItem,
    _run: Run,
    _errorCode: string,
  ): Promise<void> {}
}

export class ContextPackCheckpointService implements IContextPackCheckpointService {
  constructor(
    private readonly repository: IWorkOrderRepository,
    private readonly logger: ILogger,
  ) {}

  async checkpointAfterWorkItem(
    goal: Goal,
    completedWorkItem: WorkItem,
    _finalRun: Run | undefined,
  ): Promise<void> {
    const allWorkItems = this.repository.getWorkItemsByGoal(goal.id);

    const currentWorkItems: string[] = [];
    const completedWorkItems: string[] = [];
    const blockedWorkItems: string[] = [];

    for (const wi of allWorkItems) {
      if (wi.status === 'done') {
        completedWorkItems.push(wi.id);
      } else if (wi.status === 'blocked') {
        blockedWorkItems.push(wi.id);
      } else {
        currentWorkItems.push(wi.id);
      }
    }

    // Gather all runs for this goal's work items
    const allRuns: Run[] = [];
    for (const wi of allWorkItems) {
      const runs = this.repository.getRunsByWorkItem(wi.id);
      allRuns.push(...runs);
    }

    let successCount = 0;
    let failureCount = 0;
    const errorSignatureCounts = new Map<string, number>();

    for (const run of allRuns) {
      if (run.status === 'success') {
        successCount++;
      } else if (run.status === 'failure' || run.status === 'timeout' || run.status === 'aborted') {
        failureCount++;
      }
      if (run.error_signature) {
        errorSignatureCounts.set(
          run.error_signature,
          (errorSignatureCounts.get(run.error_signature) ?? 0) + 1,
        );
      }
    }

    const mostCommonErrors = Array.from(errorSignatureCounts.entries())
      .map(([signature, count]) => ({ signature, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Build knowledge_base
    const pitfallsDiscovered: string[] = [];
    const learnedPatterns: string[] = [];
    const successfulApproaches: string[] = [];

    for (const run of allRuns) {
      if (run.status === 'failure' && run.error_message) {
        pitfallsDiscovered.push(
          `[${run.agent_type}] ${run.error_message.slice(0, 200)}`,
        );
      }
      if (run.status === 'success') {
        learnedPatterns.push(run.agent_type);
      }
    }

    for (const wi of allWorkItems) {
      if (wi.status === 'done') {
        successfulApproaches.push(`${wi.item_type}: ${wi.title.slice(0, 150)}`);
      }
    }

    // Deduplicate learned patterns
    const uniqueLearnedPatterns = [...new Set(learnedPatterns)];

    // Cap all knowledge_base entries collectively at MAX_KNOWLEDGE_BASE_ENTRIES
    const cappedKnowledgeBase = this.capKnowledgeBase(
      pitfallsDiscovered,
      uniqueLearnedPatterns,
      successfulApproaches,
    );

    // Ready work items as recommended next actions
    const readyItems = allWorkItems
      .filter((wi) => wi.status === 'ready' || wi.status === 'queued')
      .map((wi) => wi.id);

    // Risk factors: items that have retried
    const riskFactors = allWorkItems
      .filter((wi) => wi.retry_count > 0)
      .map((wi) => `${wi.title} (${wi.retry_count} retries)`);

    const snapshot: ContextSnapshot = {
      goal_state: {
        current_work_items: currentWorkItems,
        completed_work_items: completedWorkItems,
        blocked_work_items: blockedWorkItems,
        recent_decisions: [],
        active_escalations: [],
      },
      execution_summary: {
        total_runs: allRuns.length,
        success_count: successCount,
        failure_count: failureCount,
        most_common_errors: mostCommonErrors,
      },
      knowledge_base: cappedKnowledgeBase,
      next_actions: {
        recommended_work_items: readyItems,
        risk_factors: riskFactors,
      },
    };

    this.repository.createContextPack({
      goal_id: goal.id,
      pack_type: 'daily_checkpoint',
      snapshot_data: snapshot,
    });

    this.logger.info(
      { goalId: goal.id, workItemId: completedWorkItem.id },
      `Created daily_checkpoint context pack after work item ${completedWorkItem.id}`,
    );
  }

  async checkpointOnError(
    goal: Goal,
    workItem: WorkItem,
    run: Run,
    errorCode: string,
  ): Promise<void> {
    const errorDescription = `[${errorCode}] ${workItem.title}: ${run.error_message ?? 'unknown error'}`;

    const snapshot: ContextSnapshot = {
      goal_state: {
        current_work_items: [workItem.id],
        completed_work_items: [],
        blocked_work_items: [],
        recent_decisions: [],
        active_escalations: [],
      },
      execution_summary: {
        total_runs: 1,
        success_count: 0,
        failure_count: 1,
        most_common_errors: run.error_signature
          ? [{ signature: run.error_signature, count: 1 }]
          : [],
      },
      knowledge_base: {
        learned_patterns: [],
        pitfalls_discovered: [errorDescription.slice(0, 500)],
        successful_approaches: [],
      },
      next_actions: {
        recommended_work_items: [],
        risk_factors: [`Error ${errorCode} on ${workItem.title}`],
      },
    };

    this.repository.createContextPack({
      goal_id: goal.id,
      pack_type: 'error_recovery',
      snapshot_data: snapshot,
    });

    this.logger.info(
      { goalId: goal.id, workItemId: workItem.id, runId: run.id },
      `Created error_recovery context pack for error ${errorCode}`,
    );
  }

  /**
   * Cap the total number of knowledge_base entries at MAX_KNOWLEDGE_BASE_ENTRIES.
   * Distributes the budget proportionally across the three categories,
   * with pitfalls getting priority.
   */
  private capKnowledgeBase(
    pitfalls: string[],
    patterns: string[],
    approaches: string[],
  ): ContextSnapshot['knowledge_base'] {
    const total = pitfalls.length + patterns.length + approaches.length;
    if (total <= MAX_KNOWLEDGE_BASE_ENTRIES) {
      return {
        pitfalls_discovered: pitfalls,
        learned_patterns: patterns,
        successful_approaches: approaches,
      };
    }

    // Pitfalls get up to half, remainder split between patterns and approaches
    const pitfallBudget = Math.min(
      pitfalls.length,
      Math.ceil(MAX_KNOWLEDGE_BASE_ENTRIES / 2),
    );
    const remaining = MAX_KNOWLEDGE_BASE_ENTRIES - pitfallBudget;
    const patternBudget = Math.min(
      patterns.length,
      Math.ceil(remaining / 2),
    );
    const approachBudget = Math.min(
      approaches.length,
      remaining - patternBudget,
    );

    return {
      pitfalls_discovered: pitfalls.slice(0, pitfallBudget),
      learned_patterns: patterns.slice(0, patternBudget),
      successful_approaches: approaches.slice(0, approachBudget),
    };
  }
}
