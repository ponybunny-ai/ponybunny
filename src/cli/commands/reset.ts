import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';

const runtimeConfig = loadRuntimeConfig();

async function confirmReset(dbPath: string): Promise<boolean> {
  if (!input.isTTY) {
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      chalk.yellow(`This will permanently delete data in ${dbPath}. Continue? (yes/no): `)
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

function removeFileIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export const resetCommand = new Command('reset')
  .description('Reset PonyBunny database (pony.db)')
  .option('--db <path>', 'Database path to reset', runtimeConfig.paths.database)
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--no-stop-services', 'Do not stop gateway and scheduler before reset')
  .action(async (options) => {
    const dbPath = resolve(options.db);
    const stopServices = options.stopServices !== false;

    if (!options.yes) {
      const confirmed = await confirmReset(dbPath);
      if (!confirmed) {
        console.log(chalk.yellow('Reset cancelled.'));
        if (!input.isTTY) {
          console.log(chalk.gray('Use `pb reset --yes` in non-interactive environments.'));
        }
        process.exit(1);
      }
    }

    if (stopServices) {
      console.log(chalk.blue('Stopping gateway and scheduler...'));
      try {
        execSync('pb service stop all', { stdio: 'inherit' });
      } catch {
        console.log(chalk.yellow('Service stop returned non-zero status; continuing reset.'));
      }
    }

    mkdirSync(dirname(dbPath), { recursive: true });

    removeFileIfExists(dbPath);
    removeFileIfExists(`${dbPath}-wal`);
    removeFileIfExists(`${dbPath}-shm`);

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
    repository.close();

    console.log(chalk.green('✓ Database reset completed'));
    console.log(chalk.gray(`  Database: ${dbPath}`));
    console.log(chalk.gray('  Next: run `pb service start all` if you need services running.'));
  });
