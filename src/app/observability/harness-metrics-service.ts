/**
 * HarnessMetricsService - Pure SQL aggregation over harness operational data.
 *
 * All methods are read-only and return safe defaults (empty arrays / zeroes)
 * when the underlying tables are empty or a query fails.
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Result interfaces
// ---------------------------------------------------------------------------

export interface ErrorCluster {
  error_signature: string;
  count: number;
  most_recent: number;
  affected_goals: number;
}

export interface ItemTypeFailureRate {
  item_type: string;
  total_runs: number;
  failed_runs: number;
  failure_rate: number;
}

export interface GoalTimelineEntry {
  date: string; // YYYY-MM-DD
  completed: number;
  failed: number;
}

export interface EvaluationDistribution {
  total_reports: number;
  total_publish: number;
  total_retry: number;
  total_replan: number;
  total_escalate: number;
  total_skipped: number;
}

export interface KnowledgeStats {
  total_entries: number;
  by_type: Record<string, number>;
  avg_confidence: number;
  recently_reinforced: number; // reinforced in last 7 days
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HarnessMetricsService {
  constructor(private readonly db: Database.Database) {}

  /**
   * Cluster runs by error_signature, ordered by frequency descending.
   */
  getErrorSignatureClusters(limit = 20): ErrorCluster[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT
             error_signature,
             COUNT(*)              AS count,
             MAX(created_at)       AS most_recent,
             COUNT(DISTINCT goal_id) AS affected_goals
           FROM runs
           WHERE error_signature IS NOT NULL
           GROUP BY error_signature
           ORDER BY count DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        error_signature: string;
        count: number;
        most_recent: number;
        affected_goals: number;
      }>;

      return rows;
    } catch (err) {
      console.error('[HarnessMetricsService] getErrorSignatureClusters failed:', err);
      return [];
    }
  }

  /**
   * For each work-item type, compute the failure rate across all runs.
   */
  getWorkItemTypeFailureRates(): ItemTypeFailureRate[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT
             wi.item_type,
             COUNT(r.rowid)                                      AS total_runs,
             SUM(CASE WHEN r.status = 'failure' THEN 1 ELSE 0 END) AS failed_runs
           FROM work_items wi
           JOIN runs r ON r.work_item_id = wi.id
           GROUP BY wi.item_type
           ORDER BY wi.item_type`,
        )
        .all() as Array<{
        item_type: string;
        total_runs: number;
        failed_runs: number;
      }>;

      return rows.map((r) => ({
        item_type: r.item_type,
        total_runs: r.total_runs,
        failed_runs: r.failed_runs,
        failure_rate: r.total_runs > 0 ? r.failed_runs / r.total_runs : 0,
      }));
    } catch (err) {
      console.error('[HarnessMetricsService] getWorkItemTypeFailureRates failed:', err);
      return [];
    }
  }

  /**
   * Daily goal completion / failure counts over the last N days.
   *
   * "completed" = goals whose status is 'completed'.
   * "failed"    = goals whose status is 'cancelled' or 'blocked'.
   *
   * created_at is stored in epoch milliseconds.
   */
  getGoalSuccessTimeline(days = 30): GoalTimelineEntry[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT
             strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch')) AS date,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)        AS completed,
             SUM(CASE WHEN status IN ('cancelled', 'blocked') THEN 1 ELSE 0 END) AS failed
           FROM goals
           WHERE created_at >= (strftime('%s', 'now') - ? * 86400) * 1000
           GROUP BY date
           ORDER BY date`,
        )
        .all(days) as Array<{
        date: string;
        completed: number;
        failed: number;
      }>;

      return rows;
    } catch (err) {
      console.error('[HarnessMetricsService] getGoalSuccessTimeline failed:', err);
      return [];
    }
  }

  /**
   * Aggregate decision distribution across all goal evaluation reports.
   */
  getEvaluationDecisionDistribution(): EvaluationDistribution {
    const empty: EvaluationDistribution = {
      total_reports: 0,
      total_publish: 0,
      total_retry: 0,
      total_replan: 0,
      total_escalate: 0,
      total_skipped: 0,
    };

    try {
      const row = this.db
        .prepare(
          `SELECT
             COUNT(*)                        AS total_reports,
             COALESCE(SUM(summary_publish),  0) AS total_publish,
             COALESCE(SUM(summary_retry),    0) AS total_retry,
             COALESCE(SUM(summary_replan),   0) AS total_replan,
             COALESCE(SUM(summary_escalate), 0) AS total_escalate,
             COALESCE(SUM(summary_skipped),  0) AS total_skipped
           FROM goal_evaluation_reports`,
        )
        .get() as
        | {
            total_reports: number;
            total_publish: number;
            total_retry: number;
            total_replan: number;
            total_escalate: number;
            total_skipped: number;
          }
        | undefined;

      return row ?? empty;
    } catch (err) {
      console.error('[HarnessMetricsService] getEvaluationDecisionDistribution failed:', err);
      return empty;
    }
  }

  /**
   * Stats about the global knowledge store: totals, type breakdown,
   * average confidence, and entries reinforced in the last 7 days.
   */
  getKnowledgeEffectiveness(): KnowledgeStats {
    const empty: KnowledgeStats = {
      total_entries: 0,
      by_type: {},
      avg_confidence: 0,
      recently_reinforced: 0,
    };

    try {
      // Totals + average confidence
      const summary = this.db
        .prepare(
          `SELECT
             COUNT(*)                    AS total_entries,
             COALESCE(AVG(confidence), 0) AS avg_confidence
           FROM global_knowledge`,
        )
        .get() as { total_entries: number; avg_confidence: number } | undefined;

      if (!summary || summary.total_entries === 0) {
        return empty;
      }

      // Breakdown by knowledge_type
      const typeRows = this.db
        .prepare(
          `SELECT knowledge_type, COUNT(*) AS cnt
           FROM global_knowledge
           GROUP BY knowledge_type`,
        )
        .all() as Array<{ knowledge_type: string; cnt: number }>;

      const byType: Record<string, number> = {};
      for (const r of typeRows) {
        byType[r.knowledge_type] = r.cnt;
      }

      // Recently reinforced (last 7 days, epoch ms)
      const recentRow = this.db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM global_knowledge
           WHERE last_reinforced_at >= (strftime('%s', 'now') - 7 * 86400) * 1000`,
        )
        .get() as { cnt: number } | undefined;

      return {
        total_entries: summary.total_entries,
        by_type: byType,
        avg_confidence: Math.round(summary.avg_confidence * 1000) / 1000,
        recently_reinforced: recentRow?.cnt ?? 0,
      };
    } catch (err) {
      console.error('[HarnessMetricsService] getKnowledgeEffectiveness failed:', err);
      return empty;
    }
  }
}
