/**
 * Scheduler Daemon CLI Command
 *
 * Starts the Scheduler Daemon as a separate process that executes goals
 * and sends events to Gateway via IPC.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { getLLMService } from '../../infra/llm/index.js';
import { LLMRouter, MockLLMProvider } from '../../infra/llm/llm-provider.js';
import { SchedulerDaemon } from '../../scheduler-daemon/daemon.js';

export const schedulerCommand = new Command('scheduler')
  .description('Manage the Scheduler Daemon')
  .addCommand(
    new Command('start')
      .description('Start the Scheduler Daemon')
      .option('--foreground', 'Run in foreground (default: background)')
      .option('--db <path>', 'Database path', join(homedir(), '.ponybunny', 'pony.db'))
      .option('--socket <path>', 'IPC socket path', join(homedir(), '.ponybunny', 'gateway.sock'))
      .option('--debug', 'Enable debug mode')
      .action(async (options) => {
        const dbPath = options.db;
        const socketPath = options.socket;
        const debugMode = options.debug ?? false;
        const foreground = options.foreground ?? false;

        if (!foreground) {
          console.log(chalk.yellow('Background mode not yet implemented. Running in foreground.'));
        }

        console.log(chalk.blue('Starting Scheduler Daemon...'));
        console.log(chalk.gray(`  Database: ${dbPath}`));
        console.log(chalk.gray(`  IPC Socket: ${socketPath}`));
        console.log(chalk.gray(`  Debug Mode: ${debugMode ? 'enabled' : 'disabled'}`));

        try {
          // Initialize database
          const repository = new WorkOrderDatabase(dbPath);
          await repository.initialize();

          // Initialize LLM service
          const llmService = getLLMService();
          const availableProviders = llmService.getAvailableProviders();

          let llmProvider;
          if (availableProviders.length === 0) {
            console.warn(chalk.yellow('[SchedulerDaemon] No API keys found. Using Mock LLM Provider.'));
            llmProvider = new LLMRouter([new MockLLMProvider('mock-provider')]);
          } else {
            llmProvider = llmService;
            console.log(chalk.gray(`  LLM Providers: ${availableProviders.join(', ')}`));
          }

          // Create execution service
          const executionService = new ExecutionService(
            repository,
            { maxConsecutiveErrors: 3 },
            llmProvider
          );

          // Create scheduler daemon
          const daemon = new SchedulerDaemon(
            repository,
            executionService,
            llmProvider,
            {
              ipcSocketPath: socketPath,
              dbPath,
              debug: debugMode,
              tickIntervalMs: 1000,
              maxConcurrentGoals: 5,
            }
          );

          // Handle shutdown signals
          const shutdown = async () => {
            console.log(chalk.yellow('\n[SchedulerDaemon] Shutting down gracefully...'));
            await daemon.stop();
            process.exit(0);
          };

          process.on('SIGINT', shutdown);
          process.on('SIGTERM', shutdown);

          // Start daemon
          await daemon.start();

          console.log(chalk.green('\n✓ Scheduler Daemon started successfully'));
          console.log(chalk.gray('  Press Ctrl+C to stop\n'));

          // Keep process alive
          await new Promise(() => {});
        } catch (error) {
          console.error(chalk.red('Failed to start Scheduler Daemon:'), error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('stop')
      .description('Stop the Scheduler Daemon')
      .action(() => {
        console.log(chalk.yellow('Stop command not yet implemented.'));
        console.log(chalk.gray('Use Ctrl+C to stop the daemon running in foreground.'));
      })
  )
  .addCommand(
    new Command('status')
      .description('Check Scheduler Daemon status')
      .action(() => {
        console.log(chalk.yellow('Status command not yet implemented.'));
      })
  );
