/**
 * PostGoalEvaluator — ADR-001 Phase 5
 *
 * Subscribes to SchedulerCore goal_completed / goal_failed events,
 * evaluates each work item's final run via EvaluationService,
 * and produces an observational GoalEvaluationReport.
 *
 * Design constraints:
 * - Does NOT modify GoalHarness or ISchedulerCore
 * - Reports are observational only (no side effects on scheduler state)
 * - All async errors are caught and logged — must never crash the scheduler
 * - Bounded report storage (last 100)
 */

import type { ISchedulerCore } from '../scheduler/core/types.js';
import type { IEvaluationService, EvaluationResult, VerificationResult } from '../app/lifecycle/stage-interfaces.js';
import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { SchedulerEvent, SchedulerEventHandler } from '../scheduler/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostGoalEvaluatorDependencies {
  schedulerCore: ISchedulerCore;
  evaluationService: IEvaluationService;
  repository: IWorkOrderRepository;
}

export interface WorkItemEvaluation {
  workItemId: string;
  runId: string | null;
  evaluation: EvaluationResult | null;
  skipped: boolean;
}

export interface GoalEvaluationReport {
  goalId: string;
  timestamp: number;
  trigger: 'goal_completed' | 'goal_failed';
  workItemResults: WorkItemEvaluation[];
  summary: {
    total: number;
    publish: number;
    retry: number;
    replan: number;
    escalate: number;
    skipped: number;
  };
  unactionableDecisions: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REPORTS = 100;
const LOG_PREFIX = '[PostGoalEvaluator]';

// ---------------------------------------------------------------------------
// PostGoalEvaluator
// ---------------------------------------------------------------------------

export class PostGoalEvaluator {
  private readonly schedulerCore: ISchedulerCore;
  private readonly evaluationService: IEvaluationService;
  private readonly repository: IWorkOrderRepository;

  private readonly reports: GoalEvaluationReport[] = [];
  private handler: SchedulerEventHandler | null = null;

  constructor(deps: PostGoalEvaluatorDependencies) {
    this.schedulerCore = deps.schedulerCore;
    this.evaluationService = deps.evaluationService;
    this.repository = deps.repository;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.handler !== null) {
      throw new Error(`${LOG_PREFIX} already started`);
    }

    this.handler = (event: SchedulerEvent) => {
      if (event.type !== 'goal_completed' && event.type !== 'goal_failed') {
        return;
      }

      const goalId = event.goalId;
      if (!goalId) {
        console.warn(`${LOG_PREFIX} received ${event.type} event without goalId — ignoring`);
        return;
      }

      const trigger = event.type as 'goal_completed' | 'goal_failed';

      // Fire-and-forget async evaluation — errors logged, never rethrown
      void this.evaluateGoal(goalId, trigger).catch((err) => {
        console.error(`${LOG_PREFIX} evaluation failed for goal ${goalId}:`, err);
      });
    };

    this.schedulerCore.on(this.handler);
  }

  stop(): void {
    if (this.handler === null) {
      return;
    }
    this.schedulerCore.off(this.handler);
    this.handler = null;
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  getReports(): GoalEvaluationReport[] {
    return [...this.reports];
  }

  // -------------------------------------------------------------------------
  // Core evaluation
  // -------------------------------------------------------------------------

  async evaluateGoal(
    goalId: string,
    trigger: 'goal_completed' | 'goal_failed',
  ): Promise<GoalEvaluationReport> {
    const workItems = this.repository.getWorkItemsByGoal(goalId);

    const workItemResults: WorkItemEvaluation[] = [];
    const summary = {
      total: workItems.length,
      publish: 0,
      retry: 0,
      replan: 0,
      escalate: 0,
      skipped: 0,
    };
    const unactionableDecisions: string[] = [];

    for (const workItem of workItems) {
      const runs = this.repository.getRunsByWorkItem(workItem.id);

      if (runs.length === 0) {
        workItemResults.push({
          workItemId: workItem.id,
          runId: null,
          evaluation: null,
          skipped: true,
        });
        summary.skipped++;
        continue;
      }

      // Pick latest run — highest run_sequence, fallback to last in array
      const latestRun = runs.reduce((best, current) =>
        current.run_sequence > best.run_sequence ? current : best,
      );

      // Construct synthetic verification based on trigger
      const syntheticVerification: VerificationResult = trigger === 'goal_completed'
        ? { passed: true, gateResults: [] }
        : { passed: false, gateResults: [], failureReason: 'Goal failed' };

      try {
        const evaluation = await this.evaluationService.evaluateRun(
          workItem,
          latestRun,
          syntheticVerification,
        );

        workItemResults.push({
          workItemId: workItem.id,
          runId: latestRun.id,
          evaluation,
          skipped: false,
        });

        // Tally decision
        switch (evaluation.decision) {
          case 'publish':
            summary.publish++;
            break;
          case 'retry':
            summary.retry++;
            break;
          case 'replan': {
            summary.replan++;
            const msg = `Work item ${workItem.id}: replan requested but not implemented`;
            unactionableDecisions.push(msg);
            console.warn(`${LOG_PREFIX} replan decision is unactionable: ${msg}`);
            break;
          }
          case 'escalate':
            summary.escalate++;
            break;
        }
      } catch (evalErr) {
        // Individual work item evaluation failure — log and record as skipped
        console.error(
          `${LOG_PREFIX} failed to evaluate work item ${workItem.id} run ${latestRun.id}:`,
          evalErr,
        );
        workItemResults.push({
          workItemId: workItem.id,
          runId: latestRun.id,
          evaluation: null,
          skipped: true,
        });
        summary.skipped++;
      }
    }

    const report: GoalEvaluationReport = {
      goalId,
      timestamp: Date.now(),
      trigger,
      workItemResults,
      summary,
      unactionableDecisions,
    };

    // Store report (bounded)
    this.reports.push(report);
    if (this.reports.length > MAX_REPORTS) {
      this.reports.shift();
    }

    // Log summary
    console.log(
      `${LOG_PREFIX} Goal ${goalId} evaluated: ` +
      `${summary.publish}p/${summary.retry}r/${summary.escalate}e/${summary.replan}rp/${summary.skipped}s`,
    );

    return report;
  }
}
