/**
 * `pb knowledge` — Manage the global knowledge base.
 *
 * Provides list, stats, and reinforce subcommands for
 * viewing and managing cross-goal knowledge entries.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { GlobalKnowledgeService } from '../../domain/knowledge/index.js';
import { ensureMainSchema } from '../../infra/persistence/ensure-schema.js';

const runtimeConfig = loadRuntimeConfig();

export const knowledgeCommand = new Command('knowledge')
  .description('Manage the global knowledge base')
  .option('--db <path>', 'Database path', runtimeConfig.paths.database);

// pb knowledge list
knowledgeCommand
  .command('list')
  .description('List global knowledge entries')
  .option('--type <type>', 'Filter by knowledge type (pitfall, pattern, approach, decision)')
  .option('--limit <n>', 'Max entries to show', '20')
  .action((options) => {
    const dbPath = knowledgeCommand.opts().db;
    const db = new Database(dbPath);
    ensureMainSchema(db);
    const service = new GlobalKnowledgeService(db);

    try {
      const entries = service.list({
        knowledgeType: options.type,
        limit: parseInt(options.limit, 10),
      });

      if (entries.length === 0) {
        console.log(chalk.yellow('No knowledge entries found.'));
        return;
      }

      console.log(chalk.blue(`\nGlobal Knowledge (${entries.length} entries)\n`));

      for (const entry of entries) {
        const typeColor =
          entry.knowledge_type === 'pitfall' ? chalk.red :
          entry.knowledge_type === 'pattern' ? chalk.cyan :
          entry.knowledge_type === 'approach' ? chalk.green :
          chalk.magenta;

        console.log(
          `${typeColor(`[${entry.knowledge_type}]`)} ` +
          `${chalk.gray(`(${entry.id.slice(0, 8)})`)} ` +
          `conf=${chalk.white(entry.confidence.toFixed(2))} ` +
          `x${entry.occurrence_count}`
        );
        console.log(`  ${entry.content}`);
        if (entry.domain_tags.length > 0) {
          console.log(chalk.gray(`  tags: ${entry.domain_tags.join(', ')}`));
        }
        console.log();
      }
    } finally {
      db.close();
    }
  });

// pb knowledge stats
knowledgeCommand
  .command('stats')
  .description('Show knowledge base statistics')
  .action(() => {
    const dbPath = knowledgeCommand.opts().db;
    const db = new Database(dbPath);
    ensureMainSchema(db);
    const service = new GlobalKnowledgeService(db);

    try {
      const stats = service.getStats();

      console.log(chalk.blue('\nGlobal Knowledge Statistics\n'));
      console.log(`  Total entries: ${chalk.white(String(stats.total))}`);
      console.log(`  Avg confidence: ${chalk.white(stats.avgConfidence.toFixed(2))}`);
      console.log();
      console.log('  By type:');
      console.log(`    ${chalk.red('pitfalls')}: ${stats.byType.pitfall}`);
      console.log(`    ${chalk.cyan('patterns')}: ${stats.byType.pattern}`);
      console.log(`    ${chalk.green('approaches')}: ${stats.byType.approach}`);
      console.log(`    ${chalk.magenta('decisions')}: ${stats.byType.decision}`);
      console.log();
    } finally {
      db.close();
    }
  });

// pb knowledge reinforce
knowledgeCommand
  .command('reinforce <id>')
  .description('Reinforce a knowledge entry (increase confidence and occurrence count)')
  .action((id: string) => {
    const dbPath = knowledgeCommand.opts().db;
    const db = new Database(dbPath);
    ensureMainSchema(db);
    const service = new GlobalKnowledgeService(db);

    try {
      service.reinforce(id);
      console.log(chalk.green(`Reinforced knowledge entry ${id}`));
    } catch (err) {
      console.error(chalk.red(`Failed to reinforce: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    } finally {
      db.close();
    }
  });
