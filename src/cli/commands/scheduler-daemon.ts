/**
 * Scheduler Daemon CLI Command
 *
 * Starts the Scheduler Daemon as a separate process that executes goals
 * and sends events to Gateway via IPC.
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, openSync, closeSync } from 'fs';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { AgentAService } from '../../app/agents/agent-a/agent-a-service.js';
import { getLLMService } from '../../infra/llm/index.js';
import { LLMRouter, MockLLMProvider } from '../../infra/llm/llm-provider.js';
import { SchedulerDaemon } from '../../scheduler-daemon/daemon.js';
import { getGlobalSkillRegistry } from '../../infra/skills/skill-registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PONY_DIR = join(homedir(), '.ponybunny');
const PID_FILE = join(PONY_DIR, 'scheduler.pid');
const LOG_FILE = join(PONY_DIR, 'scheduler.log');

interface PidInfo {
  pid: number;
  startedAt: number;
  dbPath: string;
  socketPath: string;
  mode: 'foreground' | 'background';
}

function ensurePonyDir(): void {
  if (!existsSync(PONY_DIR)) {
    mkdirSync(PONY_DIR, { recursive: true });
  }
}

function writePidFile(info: PidInfo): void {
  ensurePonyDir();
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

function readPidFile(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) {
      return null;
    }
    const content = readFileSync(PID_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore errors
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  ensurePonyDir();
  appendFileSync(LOG_FILE, line);
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

async function runScheduler(
  dbPath: string,
  socketPath: string,
  debugMode: boolean,
  mode: 'foreground' | 'background',
  agentAEnabled: boolean
): Promise<void> {
  const isBackground = process.env.PONY_SCHEDULER_BACKGROUND === '1';

  if (!isBackground) {
    console.log(chalk.blue('Starting Scheduler Daemon...'));
    console.log(chalk.gray(`  Database: ${dbPath}`));
    console.log(chalk.gray(`  IPC Socket: ${socketPath}`));
    console.log(chalk.gray(`  Debug Mode: ${debugMode ? 'enabled' : 'disabled'}`));
  }

  log(`Scheduler starting with db=${dbPath}, socket=${socketPath}`);

  try {
    // Initialize database
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    // Initialize LLM service
    const llmService = getLLMService();
    const availableProviders = llmService.getAvailableProviders();

    let llmProvider;
    if (availableProviders.length === 0) {
      log('No API keys found. Using Mock LLM Provider.');
      if (!isBackground) {
        console.warn(chalk.yellow('[SchedulerDaemon] No API keys found. Using Mock LLM Provider.'));
      }
      llmProvider = new LLMRouter([new MockLLMProvider('mock-provider')]);
    } else {
      llmProvider = llmService;
      if (!isBackground) {
        console.log(chalk.gray(`  LLM Providers: ${availableProviders.join(', ')}`));
      }
    }

    // Initialize Skill Registry (for enhanced execution capabilities)
    const skillRegistry = getGlobalSkillRegistry();
    const managedSkillsDir = process.env.PONYBUNNY_SKILLS_DIR || `${process.env.HOME}/.ponybunny/skills`;

    await skillRegistry.loadSkills({
      workspaceDir: process.cwd(),
      managedSkillsDir,
    });

    const loadedSkills = skillRegistry.getSkills();
    if (!isBackground && loadedSkills.length > 0) {
      console.log(chalk.gray(`  Skills Loaded: ${loadedSkills.length}`));
    }
    log(`Loaded ${loadedSkills.length} skills`);

    // Create execution service with enhanced capabilities
    const executionService = new ExecutionService(
      repository,
      { maxConsecutiveErrors: 3 },
      llmProvider
    );

    // Initialize skills for execution service
    await executionService.initializeSkills(process.cwd());

    // Initialize MCP integration (connect to external tool servers)
    await executionService.initializeMCP();

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
        agentAEnabled,
        agentAService: agentAEnabled ? AgentAService.create(llmService) : undefined,
      }
    );

    // Handle shutdown signals
    const shutdown = async () => {
      log('Scheduler shutting down...');
      if (!isBackground) {
        console.log(chalk.yellow('\n[SchedulerDaemon] Shutting down gracefully...'));
      }
      removePidFile();
      await daemon.stop();
      log('Scheduler stopped');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start daemon
    await daemon.start();

    // Write PID file
    writePidFile({
      pid: process.pid,
      startedAt: Date.now(),
      dbPath,
      socketPath,
      mode,
    });

    log(`Scheduler started successfully (PID: ${process.pid})`);

    if (!isBackground) {
      console.log(chalk.green('\n✓ Scheduler Daemon started successfully'));
      console.log(chalk.gray(`  PID: ${process.pid}`));
      console.log(chalk.gray('  Press Ctrl+C to stop\n'));
    }

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    log(`Scheduler failed to start: ${error}`);
    removePidFile();
    if (!isBackground) {
      console.error(chalk.red('Failed to start Scheduler Daemon:'), error);
    }
    process.exit(1);
  }
}

function startBackground(dbPath: string, socketPath: string, debugMode: boolean, agentAEnabled: boolean): void {
  console.log(chalk.blue('Starting Scheduler Daemon in background...'));

  const cliPath = join(__dirname, '../index.js');

  // Open log file for output
  ensurePonyDir();
  const logFd = openSync(LOG_FILE, 'a');

  const args = [cliPath, 'scheduler', 'start', '--foreground', '--db', dbPath, '--socket', socketPath];
  if (debugMode) {
    args.push('--debug');
  }
  if (agentAEnabled) {
    args.push('--agent-a');
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PONY_SCHEDULER_BACKGROUND: '1' },
  });

  child.unref();
  closeSync(logFd);

  // Wait a bit and check if it started
  setTimeout(() => {
    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      console.log(chalk.green(`\n✓ Scheduler started in background`));
      console.log(chalk.gray(`  PID: ${pidInfo.pid}`));
      console.log(chalk.gray(`  Database: ${dbPath}`));
      console.log(chalk.gray(`  Socket: ${socketPath}`));
      console.log(chalk.gray(`  Log: ${LOG_FILE}`));
      console.log(chalk.gray('\nUse `pb scheduler stop` to stop the daemon'));
    } else {
      console.log(chalk.red('Failed to start scheduler. Check logs:'));
      console.log(chalk.gray(`  ${LOG_FILE}`));
      process.exit(1);
    }
  }, 1500);
}

export const schedulerCommand = new Command('scheduler')
  .description('Manage the Scheduler Daemon')
  .addCommand(
    new Command('start')
      .description('Start the Scheduler Daemon')
      .option('--foreground', 'Run in foreground (default: background)')
      .option('--db <path>', 'Database path', join(homedir(), '.ponybunny', 'pony.db'))
      .option('--socket <path>', 'IPC socket path', join(homedir(), '.ponybunny', 'gateway.sock'))
      .option('--debug', 'Enable debug mode')
      .option('-f, --force', 'Force start even if already running')
      .option('--agent-a', 'Enable Agent A background listener loop')
      .action(async (options) => {
        const dbPath = options.db;
        const socketPath = options.socket;
        const debugMode = options.debug ?? false;
        const foreground = options.foreground ?? false;
        const force = options.force ?? false;
        const agentAEnabled = options.agentA ?? false;

        // Check if scheduler is already running
        const existingPid = readPidFile();
        if (existingPid && isProcessRunning(existingPid.pid)) {
          if (!force) {
            console.log(chalk.yellow('⚠ Scheduler is already running'));
            console.log(chalk.gray(`  PID: ${existingPid.pid}`));
            console.log(chalk.gray(`  Started: ${new Date(existingPid.startedAt).toISOString()}`));
            console.log(chalk.gray('\nUse --force to start anyway, or run `pb scheduler stop` first'));
            process.exit(1);
          }
          console.log(chalk.yellow('⚠ Stopping existing scheduler process...'));
          killProcess(existingPid.pid);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Clean up stale PID files
        removePidFile();

        if (foreground) {
          // Run in foreground
          await runScheduler(dbPath, socketPath, debugMode, 'foreground', agentAEnabled);
        } else {
          // Run in background (default)
          startBackground(dbPath, socketPath, debugMode, agentAEnabled);
        }
      })
  )
  .addCommand(
    new Command('stop')
      .description('Stop the Scheduler Daemon')
      .option('-f, --force', 'Force kill with SIGKILL')
      .action(async (options) => {
        const { force } = options;

        const pidInfo = readPidFile();
        if (!pidInfo || !isProcessRunning(pidInfo.pid)) {
          console.log(chalk.yellow('Scheduler is not running'));
          removePidFile();
          process.exit(0);
        }

        const signal = force ? 'SIGKILL' : 'SIGTERM';

        console.log(chalk.blue(`Stopping Scheduler (PID: ${pidInfo.pid})...`));

        if (killProcess(pidInfo.pid, signal)) {
          // Wait for process to stop
          let attempts = 0;
          const maxAttempts = force ? 5 : 30;

          while (attempts < maxAttempts && isProcessRunning(pidInfo.pid)) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
          }

          if (isProcessRunning(pidInfo.pid)) {
            if (!force) {
              console.log(chalk.yellow('Process did not stop gracefully, use --force to kill'));
              process.exit(1);
            } else {
              console.log(chalk.red('Failed to kill process'));
              process.exit(1);
            }
          }
        } else {
          console.log(chalk.red('Failed to send signal to process'));
          process.exit(1);
        }

        removePidFile();
        console.log(chalk.green('✓ Scheduler stopped'));
      })
  )
  .addCommand(
    new Command('status')
      .description('Check Scheduler Daemon status')
      .action(() => {
        const pidInfo = readPidFile();

        if (!pidInfo) {
          console.log(chalk.yellow('No Scheduler process found'));
          return;
        }

        const running = isProcessRunning(pidInfo.pid);

        console.log(chalk.blue('\nScheduler Daemon Status:\n'));
        console.log(chalk.white('  Status:'), running ? chalk.green('Running') : chalk.red('Not Running'));
        console.log(chalk.white('  PID:'), chalk.cyan(pidInfo.pid));
        console.log(chalk.white('  Mode:'), chalk.cyan(pidInfo.mode));
        console.log(chalk.white('  Database:'), chalk.gray(pidInfo.dbPath));
        console.log(chalk.white('  Socket:'), chalk.gray(pidInfo.socketPath));
        console.log(chalk.white('  Started:'), chalk.gray(new Date(pidInfo.startedAt).toISOString()));

        if (running) {
          console.log(chalk.white('  Uptime:'), chalk.gray(formatUptime(Date.now() - pidInfo.startedAt)));
        }

        console.log(chalk.white('  Log file:'), chalk.gray(LOG_FILE));

        if (!running) {
          console.log(chalk.yellow('\n⚠ Process is not running but PID file exists'));
          console.log(chalk.gray('  Run `pb scheduler start` to start a new instance'));
        }
        console.log();
      })
  )
  .addCommand(
    new Command('logs')
      .description('Show Scheduler logs')
      .option('-f, --follow', 'Follow log output')
      .option('-n, --lines <n>', 'Number of lines to show', '50')
      .action(async (options) => {
        const { follow, lines } = options;

        if (!existsSync(LOG_FILE)) {
          console.log(chalk.yellow('No log file found'));
          process.exit(0);
        }

        if (follow) {
          const tail = spawn('tail', ['-f', LOG_FILE], {
            stdio: 'inherit',
          });

          process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
          });
        } else {
          try {
            const output = execSync(`tail -n ${lines} "${LOG_FILE}"`, { encoding: 'utf-8' });
            console.log(output);
          } catch {
            console.log(chalk.red('Failed to read log file'));
          }
        }
      })
  );
