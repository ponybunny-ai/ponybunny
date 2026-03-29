/**
 * `pb dashboard` — Terminal-based harness metrics overview.
 *
 * Aggregates key data points across goals, work items, runs, errors,
 * knowledge, and costs for the harness-optimizer to consume at a glance.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { GlobalKnowledgeService } from '../../domain/knowledge/index.js';
import { ensureMainSchema } from '../../infra/persistence/ensure-schema.js';

const runtimeConfig = loadRuntimeConfig();

function statusColor(rate: number, goodThreshold: number, badThreshold: number): typeof chalk.green {
  if (rate >= goodThreshold) return chalk.green;
  if (rate >= badThreshold) return chalk.yellow;
  return chalk.red;
}

export const dashboardCommand = new Command('dashboard')
  .description('Comprehensive harness metrics overview')
  .option('--days <n>', 'Time window in days', '7')
  .option('--db <path>', 'Database path', runtimeConfig.paths.database)
  .action(async (options) => {
    const { days: daysStr, db: dbPath } = options;
    const days = parseInt(daysStr, 10);
    const cutoff = Date.now() - days * 86400000;

    const db = new Database(dbPath);
    ensureMainSchema(db);

    try {
      console.log(chalk.bold(`\nPonyBunny Harness Dashboard`));
      console.log(chalk.gray(`Time window: last ${days} day(s)  |  ${new Date().toISOString().slice(0, 10)}`));
      console.log(chalk.gray('─'.repeat(60)));

      // ── 1. Goal Completion Summary ──────────────────────────────
      console.log(chalk.blue.bold('\n  Goal Completion Summary'));

      const goalStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as in_progress,
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked
        FROM goals
        WHERE created_at > ?
      `).get(cutoff) as {
        total: number;
        completed: number;
        failed: number;
        in_progress: number;
        blocked: number;
      };

      if (!goalStats || goalStats.total === 0) {
        console.log(chalk.gray('  No goals in this time window'));
      } else {
        const completionRate = goalStats.total > 0
          ? (goalStats.completed / goalStats.total * 100)
          : 0;
        const rateColor = statusColor(completionRate, 70, 40);

        console.log(chalk.gray(`  Total: ${goalStats.total}  |  Completed: ${chalk.green(goalStats.completed)}  |  Failed: ${chalk.red(goalStats.failed)}  |  Active: ${chalk.yellow(goalStats.in_progress)}  |  Blocked: ${chalk.red(goalStats.blocked)}`));
        console.log(chalk.gray(`  Completion rate: ${rateColor(completionRate.toFixed(1) + '%')}`));
      }

      // ── 2. Work Item Metrics ────────────────────────────────────
      console.log(chalk.blue.bold('\n  Work Item Metrics'));

      const workStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM work_items
        WHERE created_at > ?
      `).get(cutoff) as {
        total: number;
        completed: number;
        failed: number;
      };

      const goalCountForAvg = db.prepare(`
        SELECT COUNT(DISTINCT goal_id) as goal_count
        FROM work_items
        WHERE created_at > ?
      `).get(cutoff) as { goal_count: number };

      if (!workStats || workStats.total === 0) {
        console.log(chalk.gray('  No work items in this time window'));
      } else {
        const avgPerGoal = goalCountForAvg.goal_count > 0
          ? (workStats.total / goalCountForAvg.goal_count).toFixed(1)
          : '0';
        console.log(chalk.gray(`  Total: ${workStats.total}  |  Completed: ${chalk.green(workStats.completed)}  |  Failed: ${chalk.red(workStats.failed)}`));
        console.log(chalk.gray(`  Avg per goal: ${avgPerGoal}`));
      }

      // ── 3. Run Execution Stats ──────────────────────────────────
      console.log(chalk.blue.bold('\n  Run Execution Stats'));

      const runStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeeded,
          SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failed,
          AVG(CASE WHEN time_seconds IS NOT NULL THEN time_seconds END) as avg_duration
        FROM runs
        WHERE created_at > ?
      `).get(cutoff) as {
        total: number;
        succeeded: number;
        failed: number;
        avg_duration: number | null;
      };

      if (!runStats || runStats.total === 0) {
        console.log(chalk.gray('  No runs in this time window'));
      } else {
        const successRate = runStats.total > 0
          ? (runStats.succeeded / runStats.total * 100)
          : 0;
        const rateColor = statusColor(successRate, 80, 50);
        const avgDur = runStats.avg_duration !== null
          ? runStats.avg_duration.toFixed(1) + 's'
          : 'N/A';

        console.log(chalk.gray(`  Total: ${runStats.total}  |  Succeeded: ${chalk.green(runStats.succeeded)}  |  Failed: ${chalk.red(runStats.failed)}`));
        console.log(chalk.gray(`  Success rate: ${rateColor(successRate.toFixed(1) + '%')}  |  Avg duration: ${avgDur}`));
      }

      // ── 4. Top 5 Error Signatures ──────────────────────────────
      console.log(chalk.blue.bold('\n  Top 5 Error Signatures'));

      const errorRows = db.prepare(`
        SELECT error_signature, COUNT(*) as count
        FROM runs
        WHERE error_signature IS NOT NULL AND created_at > ?
        GROUP BY error_signature
        ORDER BY count DESC
        LIMIT 5
      `).all(cutoff) as { error_signature: string; count: number }[];

      if (errorRows.length === 0) {
        console.log(chalk.gray('  No error signatures in this time window'));
      } else {
        for (let i = 0; i < errorRows.length; i++) {
          const row = errorRows[i];
          const bar = chalk.red('█'.repeat(Math.min(row.count, 20)));
          console.log(chalk.gray(`  ${i + 1}. ${row.error_signature}`));
          console.log(chalk.gray(`     ${bar} ${row.count} occurrence(s)`));
        }
      }

      // ── 5. Quality Gate Summary ─────────────────────────────────
      try {
        const qgStats = db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN verification_status = 'passed' THEN 1 ELSE 0 END) as passed
          FROM work_items
          WHERE verification_status IS NOT NULL AND created_at > ?
        `).get(cutoff) as { total: number; passed: number };

        if (qgStats && qgStats.total > 0) {
          console.log(chalk.blue.bold('\n  Quality Gate Summary'));
          const passRate = (qgStats.passed / qgStats.total * 100);
          const rateColor = statusColor(passRate, 80, 50);
          console.log(chalk.gray(`  Total checks: ${qgStats.total}  |  Pass rate: ${rateColor(passRate.toFixed(1) + '%')}`));
        }
      } catch {
        // quality_gates table may not exist; skip silently
      }

      // ── 6. Global Knowledge Base ────────────────────────────────
      try {
        const knowledgeService = new GlobalKnowledgeService(db);
        const stats = knowledgeService.getStats();
        if (stats.total > 0) {
          console.log(chalk.blue.bold('\n  Global Knowledge Base'));
          console.log(chalk.gray(`  Total entries: ${stats.total}`));
          console.log(chalk.gray(`  Pitfalls: ${stats.byType.pitfall}  |  Patterns: ${stats.byType.pattern}  |  Approaches: ${stats.byType.approach}  |  Decisions: ${stats.byType.decision}`));
          console.log(chalk.gray(`  Avg confidence: ${stats.avgConfidence.toFixed(2)}`));
        }
      } catch {
        // global_knowledge table may not exist yet
      }

      // ── 7. Cost Summary ─────────────────────────────────────────
      console.log(chalk.blue.bold('\n  Cost Summary'));

      const costStats = db.prepare(`
        SELECT
          COALESCE(SUM(cost_usd), 0) as total_cost,
          COALESCE(SUM(tokens_used), 0) as total_tokens
        FROM runs
        WHERE created_at > ?
      `).get(cutoff) as { total_cost: number; total_tokens: number };

      if (costStats.total_cost === 0 && costStats.total_tokens === 0) {
        console.log(chalk.gray('  No cost data in this time window'));
      } else {
        console.log(chalk.gray(`  Total cost: $${costStats.total_cost.toFixed(4)}`));
        console.log(chalk.gray(`  Total tokens: ${costStats.total_tokens.toLocaleString()}`));
      }

      console.log(chalk.gray('\n' + '─'.repeat(60)));
    } finally {
      db.close();
    }
  });
