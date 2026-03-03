import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { buildWorkItemRunResultDTO, type WorkItemRunResultDTO } from '../../domain/work-order/result-dto.js';

type RunRow = {
  id: string;
  work_item_id: string;
  goal_id: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  tokens_used: number;
  cost_usd: number;
  time_seconds: number;
  error_message: string | null;
  execution_log: string | null;
  artifacts: string | null;
};

type WorkItemRow = {
  id: string;
  goal_id: string;
  title: string;
  description: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type GoalRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: number;
  updated_at: number;
};

type ArtifactRow = {
  id: string;
  run_id: string;
  artifact_type: string;
  storage_type: string;
  file_path: string | null;
  blob_path: string | null;
  size_bytes: number;
  created_at: number;
};

function fmtTs(ms?: number | null): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function fmtCost(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `$${value.toFixed(4)}`;
}

function parseArtifacts(run: RunRow): string[] {
  if (!run.artifacts) return [];
  try {
    const parsed = JSON.parse(run.artifacts);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toRunResultDTO(run: RunRow, workItem?: WorkItemRow): WorkItemRunResultDTO {
  return buildWorkItemRunResultDTO({
    runId: run.id,
    workItemId: run.work_item_id,
    goalId: run.goal_id,
    status: run.status as WorkItemRunResultDTO['status'],
    createdAt: run.created_at,
    completedAt: run.completed_at ?? undefined,
    tokensUsed: run.tokens_used,
    timeSeconds: run.time_seconds,
    costUsd: run.cost_usd,
    executionLog: run.execution_log ?? undefined,
    errorMessage: run.error_message ?? undefined,
    artifactIds: parseArtifacts(run),
    workItemStatus: workItem?.status as WorkItemRunResultDTO['verification']['workItemStatus'] | undefined,
    verificationStatus: workItem?.status === 'done' ? 'passed' : 'not_started',
  });
}

function printRunSummary(result: WorkItemRunResultDTO): void {
  console.log(chalk.bold('\nRun Summary'));
  console.log(`- Run ID: ${result.ids.runId}`);
  console.log(`- Status: ${result.status}`);
  console.log(`- Goal ID: ${result.ids.goalId}`);
  console.log(`- Work Item ID: ${result.ids.workItemId}`);
  console.log(`- Started: ${fmtTs(result.timing.createdAt)}`);
  console.log(`- Completed: ${fmtTs(result.timing.completedAt)}`);
  console.log(`- Tokens: ${result.usage.tokensUsed}`);
  console.log(`- Cost: ${fmtCost(result.usage.costUsd)}`);
  console.log(`- Time: ${result.usage.timeSeconds}s`);
  console.log(`- Verification: ${result.verification.verificationStatus || '-'} / ${result.verification.workItemStatus || '-'}`);
  console.log(`- Artifacts: ${result.artifacts.count}`);

  if (result.output.errorMessage) {
    console.log(chalk.red(`- Error: ${result.output.errorMessage}`));
  }

  if (result.output.executionLog) {
    console.log(chalk.bold('\nNatural Language Output'));
    const log = String(result.output.executionLog).trim();
    if (log.length > 5000) {
      console.log(log.slice(0, 5000));
      console.log(chalk.gray('\n... output truncated. Use --run <id> and check DB/logs for full content.'));
    } else {
      console.log(log);
    }
  }
}

export const resultsCommand = new Command('results')
  .description('View completed execution results with artifact pointers')
  .option('--db <path>', 'Path to SQLite database', loadRuntimeConfig().paths.database)
  .option('--run <id>', 'Show one run in detail')
  .option('--work-item <id>', 'Show all runs for a work item')
  .option('--goal <id>', 'Show work items and runs for a goal')
  .option('-n, --limit <number>', 'Number of items to list', '10')
  .action(async (options: { db: string; run?: string; workItem?: string; goal?: string; limit?: string }) => {
    const db = new Database(options.db, { readonly: true, fileMustExist: true });

    try {
      const limit = Math.max(1, Number.parseInt(options.limit || '10', 10) || 10);

      if (options.run) {
        const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(options.run) as RunRow | undefined;
        if (!run) {
          console.error(chalk.red(`Run not found: ${options.run}`));
          process.exit(1);
        }

        const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(run.goal_id) as GoalRow | undefined;
        const workItem = db.prepare('SELECT * FROM work_items WHERE id = ?').get(run.work_item_id) as WorkItemRow | undefined;
        const artifacts = db
          .prepare('SELECT id, run_id, artifact_type, storage_type, file_path, blob_path, size_bytes, created_at FROM artifacts WHERE run_id = ? ORDER BY created_at ASC')
          .all(run.id) as ArtifactRow[];

        const dto = toRunResultDTO(run, workItem);
        printRunSummary(dto);

        if (goal) {
          console.log(chalk.bold('\nGoal Context'));
          console.log(`- ${goal.id}: ${goal.title} [${goal.status}]`);
        }
        if (workItem) {
          console.log(chalk.bold('\nWork Item Context'));
          console.log(`- ${workItem.id}: ${workItem.title} [${workItem.status}]`);
        }

        if (artifacts.length > 0) {
          console.log(chalk.bold('\nArtifacts'));
          for (const artifact of artifacts) {
            const pointer = artifact.file_path || artifact.blob_path || '(inline content in DB)';
            console.log(`- ${artifact.id} [${artifact.artifact_type}] ${pointer} (${artifact.size_bytes} bytes)`);
          }
        } else {
        const artifactIds = dto.artifacts.ids;
          if (artifactIds.length > 0) {
            console.log(chalk.bold('\nArtifacts'));
            for (const id of artifactIds) {
              console.log(`- ${id} (missing artifact row, check integrity)`);
            }
          }
        }

        console.log(chalk.bold('\nNext Actions'));
        console.log(`- View goal tree: pb debug web (then open Goal ${run.goal_id})`);
        console.log(`- Inspect events: pb debug tui`);
        return;
      }

      if (options.workItem) {
        const workItem = db.prepare('SELECT * FROM work_items WHERE id = ?').get(options.workItem) as WorkItemRow | undefined;
        if (!workItem) {
          console.error(chalk.red(`Work item not found: ${options.workItem}`));
          process.exit(1);
        }

        const runs = db
          .prepare('SELECT * FROM runs WHERE work_item_id = ? ORDER BY run_sequence DESC, created_at DESC LIMIT ?')
          .all(workItem.id, limit) as RunRow[];

        console.log(chalk.bold('\nWork Item'));
        console.log(`- ${workItem.id}: ${workItem.title}`);
        console.log(`- Status: ${workItem.status}`);
        console.log(`- Goal: ${workItem.goal_id}`);

        console.log(chalk.bold(`\nRuns (${runs.length})`));
        for (const run of runs) {
          console.log(`- ${run.id} [${run.status}] completed=${fmtTs(run.completed_at)} tokens=${run.tokens_used} cost=${fmtCost(run.cost_usd)}`);
        }

        if (runs.length > 0) {
          console.log(chalk.gray(`\nTip: pb results --run ${runs[0].id}`));
        }
        return;
      }

      if (options.goal) {
        const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(options.goal) as GoalRow | undefined;
        if (!goal) {
          console.error(chalk.red(`Goal not found: ${options.goal}`));
          process.exit(1);
        }

        const workItems = db
          .prepare('SELECT * FROM work_items WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(goal.id, limit) as WorkItemRow[];

        console.log(chalk.bold('\nGoal'));
        console.log(`- ${goal.id}: ${goal.title}`);
        console.log(`- Status: ${goal.status}`);
        console.log(`- Updated: ${fmtTs(goal.updated_at)}`);

        console.log(chalk.bold(`\nWork Items (${workItems.length})`));
        for (const item of workItems) {
          const runCountRow = db.prepare('SELECT COUNT(*) as count FROM runs WHERE work_item_id = ?').get(item.id) as {
            count: number;
          };
          console.log(`- ${item.id} [${item.status}] ${item.title} (runs=${runCountRow.count})`);
        }

        if (workItems.length > 0) {
          console.log(chalk.gray(`\nTip: pb results --work-item ${workItems[0].id}`));
        }
        return;
      }

      const runs = db
        .prepare(
          'SELECT * FROM runs WHERE status IN (\'success\',\'failure\',\'timeout\',\'aborted\') ORDER BY COALESCE(completed_at, created_at) DESC LIMIT ?'
        )
        .all(limit) as RunRow[];

      if (runs.length === 0) {
        console.log(chalk.yellow('No completed runs found yet.'));
        return;
      }

      console.log(chalk.bold(`\nLatest Completed Runs (${runs.length})`));
      for (const run of runs) {
        const dto = toRunResultDTO(run);
        const summary = dto.output.summary.slice(0, 120);
        console.log(`- ${dto.ids.runId} [${dto.status}] goal=${dto.ids.goalId} completed=${fmtTs(dto.timing.completedAt)} tokens=${dto.usage.tokensUsed} cost=${fmtCost(dto.usage.costUsd)}`);
        if (summary) {
          console.log(`  ${chalk.gray(summary)}${summary.length >= 120 ? '...' : ''}`);
        }
      }

      console.log(chalk.bold('\nNext Actions'));
      console.log(`- Run detail: pb results --run ${runs[0].id}`);
      console.log('- Full timeline/UI: pb debug web');
    } catch (error) {
      console.error(chalk.red('Failed to load results:'), (error as Error).message);
      process.exit(1);
    } finally {
      db.close();
    }
  });
