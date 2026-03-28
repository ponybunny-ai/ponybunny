/**
 * `pb failure-analysis` — Cross-goal failure pattern clustering view.
 *
 * Provides the harness-optimizer with data about which error patterns
 * are most common, which goals fail most often, and where to focus
 * improvement efforts.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { GlobalKnowledgeService } from '../../domain/knowledge/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeConfig = loadRuntimeConfig();

function ensureSchema(db: Database.Database): void {
  try {
    const schemaPath = join(__dirname, '../../infra/persistence/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  } catch {
    try {
      const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema.sql');
      const schema = readFileSync(distSchemaPath, 'utf-8');
      db.exec(schema);
    } catch {
      // Schema already exists
    }
  }
}

export const failureAnalysisCommand = new Command('failure-analysis')
  .description('Analyze failure patterns across goals')
  .option('--top <n>', 'Show top N most common error signatures', '10')
  .option('--goal <goal-id>', 'Analyze failures for a specific goal')
  .option('--db <path>', 'Database path', runtimeConfig.paths.database)
  .action(async (options) => {
    const { top, goal: goalId, db: dbPath } = options;
    const limit = parseInt(top, 10);

    const db = new Database(dbPath);
    ensureSchema(db);

    try {
      console.log(chalk.bold('\nFailure Analysis Report'));
      console.log(chalk.gray('─'.repeat(60)));

      // 1. Error signature clustering
      let errorQuery: string;
      let errorParams: (string | number)[];

      if (goalId) {
        errorQuery = `
          SELECT error_signature, COUNT(*) as count,
                 GROUP_CONCAT(DISTINCT goal_id) as goal_ids
          FROM runs
          WHERE error_signature IS NOT NULL AND goal_id = ?
          GROUP BY error_signature
          ORDER BY count DESC
          LIMIT ?
        `;
        errorParams = [goalId, limit];
        console.log(chalk.blue(`\nError signatures for goal ${goalId.slice(0, 8)}:`));
      } else {
        errorQuery = `
          SELECT error_signature, COUNT(*) as count,
                 GROUP_CONCAT(DISTINCT goal_id) as goal_ids
          FROM runs
          WHERE error_signature IS NOT NULL
          GROUP BY error_signature
          ORDER BY count DESC
          LIMIT ?
        `;
        errorParams = [limit];
        console.log(chalk.blue(`\nTop ${limit} error signatures (cross-goal):`));
      }

      const errorRows = db.prepare(errorQuery).all(...errorParams) as {
        error_signature: string;
        count: number;
        goal_ids: string;
      }[];

      if (errorRows.length === 0) {
        console.log(chalk.gray('  No error signatures found'));
      } else {
        for (let i = 0; i < errorRows.length; i++) {
          const row = errorRows[i];
          const goalCount = row.goal_ids.split(',').length;
          const bar = '█'.repeat(Math.min(row.count, 30));
          console.log(chalk.white(`\n  ${i + 1}. ${row.error_signature}`));
          console.log(chalk.red(`     ${bar} ${row.count} occurrence(s) across ${goalCount} goal(s)`));
        }
      }

      // 2. Goal failure rates
      console.log(chalk.blue('\n\nGoal failure rates:'));

      const goalStatsQuery = goalId
        ? `SELECT g.id, g.title, g.status,
             (SELECT COUNT(*) FROM runs r WHERE r.goal_id = g.id) as total_runs,
             (SELECT COUNT(*) FROM runs r WHERE r.goal_id = g.id AND r.status = 'failed') as failed_runs
           FROM goals g WHERE g.id = ?`
        : `SELECT g.id, g.title, g.status,
             (SELECT COUNT(*) FROM runs r WHERE r.goal_id = g.id) as total_runs,
             (SELECT COUNT(*) FROM runs r WHERE r.goal_id = g.id AND r.status = 'failed') as failed_runs
           FROM goals g
           HAVING total_runs > 0
           ORDER BY failed_runs DESC
           LIMIT ?`;
      const goalParams = goalId ? [goalId] : [limit];

      const goalRows = db.prepare(goalStatsQuery).all(...goalParams) as {
        id: string;
        title: string;
        status: string;
        total_runs: number;
        failed_runs: number;
      }[];

      if (goalRows.length === 0) {
        console.log(chalk.gray('  No goals with runs found'));
      } else {
        for (const row of goalRows) {
          const failRate = row.total_runs > 0 ? (row.failed_runs / row.total_runs * 100).toFixed(0) : '0';
          const color = parseInt(failRate) > 50 ? chalk.red : parseInt(failRate) > 20 ? chalk.yellow : chalk.green;
          console.log(chalk.white(`  ${row.id.slice(0, 8)} ${row.title}`));
          console.log(chalk.gray(`    Status: ${row.status}  |  Runs: ${row.total_runs}  |  Failed: ${row.failed_runs}  |  Fail rate: ${color(failRate + '%')}`));
        }
      }

      // 3. Work item type failure distribution
      console.log(chalk.blue('\n\nFailures by work item type:'));

      const typeQuery = `
        SELECT wi.item_type, COUNT(*) as total,
               SUM(CASE WHEN wi.status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM work_items wi
        GROUP BY wi.item_type
        ORDER BY failed DESC
      `;

      const typeRows = db.prepare(typeQuery).all() as {
        item_type: string;
        total: number;
        failed: number;
      }[];

      if (typeRows.length === 0) {
        console.log(chalk.gray('  No work items found'));
      } else {
        for (const row of typeRows) {
          const failRate = row.total > 0 ? (row.failed / row.total * 100).toFixed(0) : '0';
          console.log(chalk.gray(`  ${row.item_type}: ${row.total} total, ${row.failed} failed (${failRate}%)`));
        }
      }

      // 4. Global knowledge summary (if available)
      try {
        const knowledgeService = new GlobalKnowledgeService(db);
        const stats = knowledgeService.getStats();
        if (stats.total > 0) {
          console.log(chalk.blue('\n\nGlobal knowledge base:'));
          console.log(chalk.gray(`  Total entries: ${stats.total}`));
          console.log(chalk.gray(`  Pitfalls: ${stats.byType.pitfall}  |  Patterns: ${stats.byType.pattern}  |  Approaches: ${stats.byType.approach}  |  Decisions: ${stats.byType.decision}`));
          console.log(chalk.gray(`  Avg confidence: ${stats.avgConfidence.toFixed(2)}`));

          // Show top pitfalls
          const topPitfalls = knowledgeService.getRelevantKnowledge({ knowledgeType: 'pitfall', limit: 5 });
          if (topPitfalls.length > 0) {
            console.log(chalk.yellow('\n  Top pitfalls:'));
            for (const p of topPitfalls) {
              console.log(chalk.gray(`    [${p.confidence.toFixed(1)}] (${p.occurrence_count}x) ${p.content}`));
            }
          }
        }
      } catch {
        // global_knowledge table may not exist yet
      }

      console.log(chalk.gray('\n' + '─'.repeat(60)));
    } finally {
      db.close();
    }
  });
