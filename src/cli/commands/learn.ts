/**
 * `pb learn` — Extract reusable knowledge from completed/failed goals.
 *
 * This command is the primary tool for the harness-optimizer role:
 * it reads ContextPack data from goals and populates the global_knowledge table.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { GlobalKnowledgeService } from '../../domain/knowledge/index.js';
import { ensureMainSchema } from '../../infra/persistence/ensure-schema.js';
import type { ContextPack, ContextPackRow } from '../../work-order/types/index.js';

const runtimeConfig = loadRuntimeConfig();

function parseContextPackRow(row: ContextPackRow): ContextPack {
  return {
    ...row,
    snapshot_data: JSON.parse(row.snapshot_data),
    compressed: Boolean(row.compressed),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

export const learnCommand = new Command('learn')
  .description('Extract knowledge from goals into the global knowledge base')
  .option('--goal <goal-id>', 'Analyze a specific goal')
  .option('--all', 'Analyze all goals with context packs')
  .option('--dry-run', 'Preview extraction without writing to database')
  .option('--db <path>', 'Database path', runtimeConfig.paths.database)
  .action(async (options) => {
    const { goal: goalId, all, dryRun, db: dbPath } = options;

    if (!goalId && !all) {
      console.log(chalk.yellow('Specify --goal <id> or --all'));
      console.log(chalk.gray('  pb learn --goal <goal-id>     # Analyze one goal'));
      console.log(chalk.gray('  pb learn --all                # Analyze all goals'));
      console.log(chalk.gray('  pb learn --all --dry-run      # Preview without writing'));
      process.exit(1);
    }

    const db = new Database(dbPath);
    ensureMainSchema(db);
    const knowledgeService = new GlobalKnowledgeService(db);

    try {
      // Get context packs to process
      let packs: ContextPack[];

      if (goalId) {
        const row = db.prepare(
          'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(goalId) as ContextPackRow | undefined;

        if (!row) {
          console.log(chalk.yellow(`No context pack found for goal ${goalId}`));
          db.close();
          process.exit(0);
        }
        packs = [parseContextPackRow(row)];
      } else {
        // --all: get the latest context pack per goal
        const rows = db.prepare(`
          SELECT cp.* FROM context_packs cp
          INNER JOIN (
            SELECT goal_id, MAX(created_at) as max_created
            FROM context_packs
            GROUP BY goal_id
          ) latest ON cp.goal_id = latest.goal_id AND cp.created_at = latest.max_created
          ORDER BY cp.created_at DESC
        `).all() as ContextPackRow[];

        packs = rows.map(parseContextPackRow);
      }

      if (packs.length === 0) {
        console.log(chalk.yellow('No context packs found'));
        db.close();
        process.exit(0);
      }

      console.log(chalk.blue(`\nAnalyzing ${packs.length} context pack(s)...\n`));

      let totalExtracted = 0;

      for (const pack of packs) {
        const kb = pack.snapshot_data.knowledge_base;
        const itemCount =
          kb.pitfalls_discovered.length +
          kb.learned_patterns.length +
          kb.successful_approaches.length;

        if (itemCount === 0) {
          console.log(chalk.gray(`  Goal ${pack.goal_id.slice(0, 8)}: no knowledge to extract`));
          continue;
        }

        console.log(chalk.white(`  Goal ${pack.goal_id.slice(0, 8)}:`));

        if (kb.pitfalls_discovered.length > 0) {
          console.log(chalk.red(`    Pitfalls (${kb.pitfalls_discovered.length}):`));
          for (const p of kb.pitfalls_discovered) {
            console.log(chalk.gray(`      - ${p}`));
          }
        }

        if (kb.learned_patterns.length > 0) {
          console.log(chalk.cyan(`    Patterns (${kb.learned_patterns.length}):`));
          for (const p of kb.learned_patterns) {
            console.log(chalk.gray(`      - ${p}`));
          }
        }

        if (kb.successful_approaches.length > 0) {
          console.log(chalk.green(`    Approaches (${kb.successful_approaches.length}):`));
          for (const a of kb.successful_approaches) {
            console.log(chalk.gray(`      - ${a}`));
          }
        }

        if (!dryRun) {
          const extracted = knowledgeService.extractFromContextPack(pack);
          totalExtracted += extracted.length;
          console.log(chalk.dim(`    → ${extracted.length} entries recorded/reinforced`));
        } else {
          totalExtracted += itemCount;
          console.log(chalk.dim(`    → ${itemCount} entries would be recorded (dry-run)`));
        }
      }

      console.log();
      if (dryRun) {
        console.log(chalk.yellow(`Dry run complete. ${totalExtracted} entries would be written.`));
      } else {
        console.log(chalk.green(`Done. ${totalExtracted} knowledge entries recorded/reinforced.`));
        const stats = knowledgeService.getStats();
        console.log(chalk.gray(`  Total in knowledge base: ${stats.total}`));
        console.log(chalk.gray(`  By type: pitfalls=${stats.byType.pitfall}, patterns=${stats.byType.pattern}, approaches=${stats.byType.approach}, decisions=${stats.byType.decision}`));
        console.log(chalk.gray(`  Avg confidence: ${stats.avgConfidence.toFixed(2)}`));
      }
    } finally {
      db.close();
    }
  });
