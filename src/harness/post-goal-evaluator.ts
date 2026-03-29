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
import type { GlobalKnowledgeService } from '../domain/knowledge/index.js';
import type { ContextSnapshot } from '../work-order/types/index.js';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostGoalEvaluatorDependencies {
  schedulerCore: ISchedulerCore;
  evaluationService: IEvaluationService;
  repository: IWorkOrderRepository;
  globalKnowledgeService?: GlobalKnowledgeService;
  db?: Database.Database;
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
  trigger: 'goal_completed' | 'goal_failed' | 'goal_blocked';
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
  private readonly globalKnowledgeService?: GlobalKnowledgeService;
  private readonly db?: Database.Database;

  private readonly reports: GoalEvaluationReport[] = [];
  private handler: SchedulerEventHandler | null = null;

  constructor(deps: PostGoalEvaluatorDependencies) {
    this.schedulerCore = deps.schedulerCore;
    this.evaluationService = deps.evaluationService;
    this.repository = deps.repository;
    this.globalKnowledgeService = deps.globalKnowledgeService;
    this.db = deps.db;
    if (this.db) {
      this.ensureTable();
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private ensureTable(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal_evaluation_reports (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        goal_id TEXT NOT NULL,
        "trigger" TEXT NOT NULL CHECK("trigger" IN ('goal_completed', 'goal_failed', 'goal_blocked')),
        work_item_results TEXT NOT NULL,
        summary_total INTEGER NOT NULL DEFAULT 0,
        summary_publish INTEGER NOT NULL DEFAULT 0,
        summary_retry INTEGER NOT NULL DEFAULT 0,
        summary_replan INTEGER NOT NULL DEFAULT 0,
        summary_escalate INTEGER NOT NULL DEFAULT 0,
        summary_skipped INTEGER NOT NULL DEFAULT 0,
        unactionable_decisions TEXT,
        FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_eval_reports_goal ON goal_evaluation_reports(goal_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_goal_eval_reports_created ON goal_evaluation_reports(created_at DESC)`);
  }

  private persistReport(report: GoalEvaluationReport): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO goal_evaluation_reports
          (id, created_at, goal_id, "trigger", work_item_results,
           summary_total, summary_publish, summary_retry, summary_replan,
           summary_escalate, summary_skipped, unactionable_decisions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        report.timestamp,
        report.goalId,
        report.trigger,
        JSON.stringify(report.workItemResults),
        report.summary.total,
        report.summary.publish,
        report.summary.retry,
        report.summary.replan,
        report.summary.escalate,
        report.summary.skipped,
        JSON.stringify(report.unactionableDecisions),
      );
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to persist report for goal ${report.goalId}:`, err);
    }
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
  // Blocked goal ContextPack (Gap 2.A completion)
  // -------------------------------------------------------------------------

  /**
   * Create a ContextPack for a goal that was blocked during elaboration.
   * Called by HarnessDaemon when GoalHarness reports a blocked goal.
   * Does NOT trigger full evaluation — blocked goals may resume later.
   */
  createBlockedGoalContextPack(goalId: string): void {
    this.createContextPackForGoal(goalId, 'goal_blocked');
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  getReports(options?: { goalId?: string; limit?: number }): GoalEvaluationReport[] {
    if (!this.db) {
      let result = [...this.reports];
      if (options?.goalId) {
        result = result.filter(r => r.goalId === options.goalId);
      }
      if (options?.limit) {
        result = result.slice(-options.limit);
      }
      return result;
    }

    try {
      let sql = `SELECT * FROM goal_evaluation_reports`;
      const params: unknown[] = [];

      if (options?.goalId) {
        sql += ` WHERE goal_id = ?`;
        params.push(options.goalId);
      }

      sql += ` ORDER BY created_at DESC`;

      if (options?.limit) {
        sql += ` LIMIT ?`;
        params.push(options.limit);
      }

      const rows = this.db.prepare(sql).all(...params) as Array<{
        id: string;
        created_at: number;
        goal_id: string;
        trigger: 'goal_completed' | 'goal_failed' | 'goal_blocked';
        work_item_results: string;
        summary_total: number;
        summary_publish: number;
        summary_retry: number;
        summary_replan: number;
        summary_escalate: number;
        summary_skipped: number;
        unactionable_decisions: string | null;
      }>;

      return rows.map(row => ({
        goalId: row.goal_id,
        timestamp: row.created_at,
        trigger: row.trigger,
        workItemResults: JSON.parse(row.work_item_results),
        summary: {
          total: row.summary_total,
          publish: row.summary_publish,
          retry: row.summary_retry,
          replan: row.summary_replan,
          escalate: row.summary_escalate,
          skipped: row.summary_skipped,
        },
        unactionableDecisions: row.unactionable_decisions
          ? JSON.parse(row.unactionable_decisions)
          : [],
      }));
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to load reports from DB:`, err);
      return [...this.reports];
    }
  }

  // -------------------------------------------------------------------------
  // Knowledge extraction (flywheel write side)
  // -------------------------------------------------------------------------

  /**
   * After goal evaluation, extract knowledge from the goal's ContextPack
   * into GlobalKnowledgeService. This closes the failure learning flywheel:
   *   Goal completes → PostGoalEvaluator → extractFromContextPack → global_knowledge table
   *   Next goal → Elaboration → getRelevantKnowledge → pitfalls injected
   *
   * Errors are caught and logged — knowledge extraction must never crash the scheduler.
   */
  private async extractKnowledgeForGoal(goalId: string): Promise<void> {
    if (!this.globalKnowledgeService) {
      return;
    }

    try {
      const contextPack = this.repository.getLatestContextPack(goalId);
      if (!contextPack) {
        console.log(`${LOG_PREFIX} No ContextPack found for goal ${goalId} — skipping knowledge extraction`);
        return;
      }

      const extracted = this.globalKnowledgeService.extractFromContextPack(contextPack);
      if (extracted.length > 0) {
        console.log(
          `${LOG_PREFIX} Extracted ${extracted.length} knowledge entries from goal ${goalId}`,
        );
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Knowledge extraction failed for goal ${goalId}:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // ContextPack creation (flywheel prerequisite)
  // -------------------------------------------------------------------------

  /**
   * Create a ContextPack capturing goal state at completion/failure.
   * This ensures a ContextPack exists for subsequent knowledge extraction.
   * Pack type: 'daily_checkpoint' for completed goals, 'error_recovery' for failed.
   *
   * Errors are caught and logged — must never crash the scheduler.
   */
  private createContextPackForGoal(
    goalId: string,
    trigger: 'goal_completed' | 'goal_failed' | 'goal_blocked',
  ): void {
    try {
      const workItems = this.repository.getWorkItemsByGoal(goalId);

      const currentItems: string[] = [];
      const completedItems: string[] = [];
      const blockedItems: string[] = [];

      for (const wi of workItems) {
        if (wi.status === 'done') {
          completedItems.push(wi.id);
        } else if (wi.status === 'blocked') {
          blockedItems.push(wi.id);
        } else {
          currentItems.push(wi.id);
        }
      }

      // Gather run statistics
      let totalRuns = 0;
      let successCount = 0;
      let failureCount = 0;
      const errorSignatures = new Map<string, number>();

      for (const wi of workItems) {
        const runs = this.repository.getRunsByWorkItem(wi.id);
        totalRuns += runs.length;
        for (const run of runs) {
          if (run.status === 'success') successCount++;
          if (run.status === 'failure') failureCount++;
          if (run.error_signature) {
            errorSignatures.set(
              run.error_signature,
              (errorSignatures.get(run.error_signature) || 0) + 1,
            );
          }
        }
      }

      const mostCommonErrors = [...errorSignatures.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([signature, count]) => ({ signature, count }));

      const packType = trigger === 'goal_completed' ? 'daily_checkpoint' : 'error_recovery';

      const snapshotData: ContextSnapshot = {
        goal_state: {
          current_work_items: currentItems,
          completed_work_items: completedItems,
          blocked_work_items: blockedItems,
          recent_decisions: [],
          active_escalations: [],
        },
        execution_summary: {
          total_runs: totalRuns,
          success_count: successCount,
          failure_count: failureCount,
          most_common_errors: mostCommonErrors,
        },
        knowledge_base: {
          learned_patterns: [],
          pitfalls_discovered: [],
          successful_approaches: [],
        },
        next_actions: {
          recommended_work_items: [],
          risk_factors: [],
        },
      };

      this.repository.createContextPack({
        goal_id: goalId,
        pack_type: packType,
        snapshot_data: snapshotData,
      });

      console.log(`${LOG_PREFIX} Created ${packType} ContextPack for goal ${goalId}`);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to create ContextPack for goal ${goalId}:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Core evaluation
  // -------------------------------------------------------------------------

  async evaluateGoal(
    goalId: string,
    trigger: 'goal_completed' | 'goal_failed' | 'goal_blocked',
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

    // Store report (bounded in-memory cache)
    this.reports.push(report);
    if (this.reports.length > MAX_REPORTS) {
      this.reports.shift();
    }

    // Persist to SQLite (if available)
    this.persistReport(report);

    // Create ContextPack for this goal (must happen before knowledge extraction)
    this.createContextPackForGoal(goalId, trigger);

    // Log summary
    console.log(
      `${LOG_PREFIX} Goal ${goalId} evaluated: ` +
      `${summary.publish}p/${summary.retry}r/${summary.escalate}e/${summary.replan}rp/${summary.skipped}s`,
    );

    // Extract knowledge from ContextPack into GlobalKnowledge (flywheel write side)
    await this.extractKnowledgeForGoal(goalId);

    return report;
  }
}
