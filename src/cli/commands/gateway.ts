/**
 * Gateway CLI Commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  openSync,
  closeSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { spawn, execSync } from 'child_process';

import { GatewayServer, type Permission, createScheduler } from '../../gateway/index.js';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { startGatewayTui } from '../ui/gateway-tui.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { getLLMService } from '../../infra/llm/index.js';
import { MockLLMProvider, LLMRouter } from '../../infra/llm/llm-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_DB_PATH = process.env.PONY_DB_PATH || './pony.db';
const DEFAULT_HOST = process.env.PONY_GATEWAY_HOST || '127.0.0.1';
const DEFAULT_PORT = parseInt(process.env.PONY_GATEWAY_PORT || '18789', 10);

// PID and log file locations
const PONY_DIR = join(homedir(), '.ponybunny');
const PID_FILE = join(PONY_DIR, 'gateway.pid');
const LOG_FILE = join(PONY_DIR, 'gateway.log');
const DAEMON_PID_FILE = join(PONY_DIR, 'gateway-daemon.pid');

interface PidInfo {
  pid: number;
  daemonPid?: number;
  host: string;
  port: number;
  startedAt: number;
  dbPath: string;
  mode: 'foreground' | 'background' | 'daemon';
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

function writeDaemonPidFile(pid: number): void {
  ensurePonyDir();
  writeFileSync(DAEMON_PID_FILE, String(pid));
}

function readDaemonPidFile(): number | null {
  try {
    if (!existsSync(DAEMON_PID_FILE)) {
      return null;
    }
    return parseInt(readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

function removeDaemonPidFile(): void {
  try {
    if (existsSync(DAEMON_PID_FILE)) {
      unlinkSync(DAEMON_PID_FILE);
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

function findProcessByPort(port: number): number | null {
  try {
    const output = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' });
    const pids = output.trim().split('\n').filter(Boolean);
    if (pids.length > 0) {
      return parseInt(pids[0], 10);
    }
    return null;
  } catch {
    return null;
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
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export const gatewayCommand = new Command('gateway')
  .description('Gateway server management');

gatewayCommand
  .command('start')
  .description('Start the Gateway WebSocket server')
  .option('-h, --host <host>', 'Host to bind to', DEFAULT_HOST)
  .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .option('-f, --force', 'Force start even if another instance is running')
  .option('--foreground', 'Run in foreground (default is background)')
  .option('--daemon', 'Run with daemon supervisor (auto-restart on crash)')
  .option('--debug', 'Enable debug mode for event tracing')
  .action(async (options) => {
    const { host, port, db: dbPath, force, foreground, daemon, debug } = options;

    // Check if gateway is already running
    const existingPid = readPidFile();
    if (existingPid && isProcessRunning(existingPid.pid)) {
      if (!force) {
        console.log(chalk.yellow('⚠ Gateway is already running'));
        console.log(chalk.gray(`  PID: ${existingPid.pid}`));
        console.log(chalk.gray(`  Address: ws://${existingPid.host}:${existingPid.port}`));
        console.log(chalk.gray(`  Started: ${new Date(existingPid.startedAt).toISOString()}`));
        console.log(chalk.gray('\nUse --force to start anyway, or run `pb gateway stop` first'));
        process.exit(1);
      }
      console.log(chalk.yellow('⚠ Stopping existing gateway process...'));
      // Stop daemon if running
      const daemonPid = existingPid.daemonPid || readDaemonPidFile();
      if (daemonPid && isProcessRunning(daemonPid)) {
        killProcess(daemonPid);
      }
      killProcess(existingPid.pid);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Clean up stale PID files
    removePidFile();
    removeDaemonPidFile();

    // Resolve absolute path for database
    const absoluteDbPath = resolve(dbPath);

    // Check for debug mode from environment or CLI option
    const debugEnabled = process.env.DEBUG_MODE === 'true' || debug;

    if (daemon) {
      // Start daemon supervisor
      startDaemon(host, port, absoluteDbPath, debugEnabled);
    } else if (foreground) {
      // Run in foreground
      await runGateway(host, parseInt(port, 10), absoluteDbPath, 'foreground', debugEnabled);
    } else {
      // Run in background (default)
      startBackground(host, port, absoluteDbPath, debugEnabled);
    }
  });

function startBackground(host: string, port: string, dbPath: string, debugEnabled: boolean): void {
  console.log(chalk.blue('Starting PonyBunny Gateway in background...'));

  const cliPath = join(__dirname, '../index.js');

  // Open log file for output
  ensurePonyDir();
  const logFd = openSync(LOG_FILE, 'a');

  const args = [cliPath, 'gateway', 'start', '--foreground', '-h', host, '-p', port, '-d', dbPath];
  if (debugEnabled) {
    args.push('--debug');
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PONY_GATEWAY_BACKGROUND: '1' },
  });

  child.unref();
  closeSync(logFd);

  // Wait a bit and check if it started
  setTimeout(() => {
    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      console.log(chalk.green(`\n✓ Gateway started in background`));
      console.log(chalk.gray(`  PID: ${pidInfo.pid}`));
      console.log(chalk.gray(`  Address: ws://${host}:${port}`));
      console.log(chalk.gray(`  Log: ${LOG_FILE}`));
      console.log(chalk.gray('\nUse `pb gateway stop` to stop the server'));
    } else {
      console.log(chalk.red('Failed to start gateway. Check logs:'));
      console.log(chalk.gray(`  ${LOG_FILE}`));
      process.exit(1);
    }
  }, 1500);
}

function startDaemon(host: string, port: string, dbPath: string, debugEnabled: boolean): void {
  console.log(chalk.blue('Starting PonyBunny Gateway with daemon supervisor...'));

  const cliPath = join(__dirname, '../index.js');

  ensurePonyDir();
  const logFd = openSync(LOG_FILE, 'a');

  const args = [cliPath, 'gateway', 'daemon-run', '-h', host, '-p', port, '-d', dbPath];
  if (debugEnabled) {
    args.push('--debug');
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PONY_GATEWAY_DAEMON: '1' },
  });

  child.unref();
  closeSync(logFd);

  // Wait a bit and check if it started
  setTimeout(() => {
    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      console.log(chalk.green(`\n✓ Gateway started with daemon supervisor`));
      console.log(chalk.gray(`  Gateway PID: ${pidInfo.pid}`));
      console.log(chalk.gray(`  Daemon PID: ${pidInfo.daemonPid || 'N/A'}`));
      console.log(chalk.gray(`  Address: ws://${host}:${port}`));
      console.log(chalk.gray(`  Log: ${LOG_FILE}`));
      console.log(chalk.gray('\nThe daemon will automatically restart the gateway if it crashes.'));
      console.log(chalk.gray('Use `pb gateway stop` to stop both daemon and gateway.'));
    } else {
      console.log(chalk.red('Failed to start gateway. Check logs:'));
      console.log(chalk.gray(`  ${LOG_FILE}`));
      process.exit(1);
    }
  }, 2000);
}

// Internal command for daemon supervisor
gatewayCommand
  .command('daemon-run')
  .description('Internal: Run daemon supervisor (do not call directly)')
  .option('-h, --host <host>', 'Host to bind to', DEFAULT_HOST)
  .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .option('--debug', 'Enable debug mode for event tracing')
  .action(async (options) => {
    const { host, port, db: dbPath, debug: debugEnabled } = options;

    log(`Daemon supervisor starting for ws://${host}:${port}`);
    writeDaemonPidFile(process.pid);

    let gatewayProcess: ReturnType<typeof spawn> | null = null;
    let shouldRestart = true;
    let restartCount = 0;
    let lastRestartTime = Date.now();

    const startGateway = () => {
      const cliPath = join(__dirname, '../index.js');

      log(`Starting gateway process (restart #${restartCount})`);

      const args = [cliPath, 'gateway', 'start', '--foreground', '-h', host, '-p', port, '-d', dbPath];
      if (debugEnabled) {
        args.push('--debug');
      }

      gatewayProcess = spawn(process.execPath, args, {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, PONY_GATEWAY_DAEMON_CHILD: '1' },
      });

      gatewayProcess.on('exit', (code, signal) => {
        log(`Gateway process exited with code ${code}, signal ${signal}`);

        if (!shouldRestart) {
          log('Daemon shutting down (restart disabled)');
          removeDaemonPidFile();
          process.exit(0);
        }

        // Rate limit restarts
        const now = Date.now();
        if (now - lastRestartTime < 5000) {
          restartCount++;
          if (restartCount > 5) {
            log('Too many restarts in short period, waiting 30 seconds...');
            setTimeout(() => {
              restartCount = 0;
              startGateway();
            }, 30000);
            return;
          }
        } else {
          restartCount = 0;
        }
        lastRestartTime = now;

        // Restart after a short delay
        log('Restarting gateway in 2 seconds...');
        setTimeout(startGateway, 2000);
      });

      // Update PID file with daemon info
      setTimeout(() => {
        const pidInfo = readPidFile();
        if (pidInfo) {
          pidInfo.daemonPid = process.pid;
          pidInfo.mode = 'daemon';
          writePidFile(pidInfo);
        }
      }, 500);
    };

    // Handle shutdown signals
    const shutdown = () => {
      log('Daemon received shutdown signal');
      shouldRestart = false;
      if (gatewayProcess) {
        gatewayProcess.kill('SIGTERM');
      }
      removeDaemonPidFile();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Start the gateway
    startGateway();

    // Keep daemon alive
    await new Promise(() => {});
  });

async function runGateway(host: string, port: number, dbPath: string, _mode: 'foreground' | 'background' | 'daemon', debugEnabled: boolean = false): Promise<void> {
  const isBackground = process.env.PONY_GATEWAY_BACKGROUND === '1';
  const isDaemonChild = process.env.PONY_GATEWAY_DAEMON_CHILD === '1';

  // Determine actual mode based on environment
  const actualMode: 'foreground' | 'background' | 'daemon' = isDaemonChild ? 'daemon' : isBackground ? 'background' : 'foreground';

  if (!isBackground && !isDaemonChild) {
    console.log(chalk.blue('Starting PonyBunny Gateway Server...'));
    console.log(chalk.gray(`  Database: ${dbPath}`));
    console.log(chalk.gray(`  Address: ws://${host}:${port}`));
  }

  log(`Gateway starting on ws://${host}:${port}`);

  try {
    // Initialize database
    const db = new Database(dbPath);

    // Load and run schema
    const schemaPath = join(__dirname, '../../infra/persistence/schema.sql');
    try {
      const schema = readFileSync(schemaPath, 'utf-8');
      db.exec(schema);
    } catch {
      const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema.sql');
      const schema = readFileSync(distSchemaPath, 'utf-8');
      db.exec(schema);
    }

    // Initialize repository
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    // Initialize LLM provider
    const llmService = getLLMService();
    const availableProviders = llmService.getAvailableProviders();
    let llmRouter: LLMRouter;

    if (availableProviders.length === 0) {
      log('No API keys found. Using Mock LLM Provider.');
      if (!isBackground && !isDaemonChild) {
        console.log(chalk.yellow('⚠ No API keys found. Using Mock LLM Provider.'));
      }
      llmRouter = new LLMRouter([new MockLLMProvider('mock-provider')]);
    } else {
      llmRouter = llmService.createRouter();
      if (!isBackground && !isDaemonChild) {
        console.log(chalk.gray(`  LLM Providers: ${availableProviders.join(', ')}`));
      }
    }

    // Create execution service
    const executionService = new ExecutionService(repository, {
      maxConsecutiveErrors: 3,
    }, llmRouter);

    // Create scheduler
    const scheduler = createScheduler(
      { repository, executionService, llmProvider: llmRouter },
      { autoStart: true, debug: !isBackground && !isDaemonChild }
    );

    // Create and start gateway
    const gateway = new GatewayServer(
      { db, repository, debugMode: debugEnabled },
      { host, port }
    );

    await gateway.start();

    // Connect scheduler to gateway
    gateway.connectScheduler(scheduler);

    // Start the scheduler
    await scheduler.start();
    log('Scheduler started');

    // Write PID file
    writePidFile({
      pid: process.pid,
      host,
      port,
      startedAt: Date.now(),
      dbPath,
      mode: actualMode,
    });

    log(`Gateway started successfully (PID: ${process.pid})`);

    if (!isBackground && !isDaemonChild) {
      console.log(chalk.green(`\n✓ Gateway server running on ws://${host}:${port}`));
      console.log(chalk.gray(`  PID: ${process.pid}`));
      console.log(chalk.gray('\nPress Ctrl+C to stop\n'));
    }

    // Handle shutdown
    const cleanup = async () => {
      log('Gateway shutting down...');
      if (!isBackground && !isDaemonChild) {
        console.log(chalk.yellow('\nShutting down...'));
      }
      removePidFile();
      await scheduler.stop();
      await gateway.stop();
      db.close();
      log('Gateway stopped');
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    log(`Gateway failed to start: ${error}`);
    removePidFile();
    if (!isBackground && !isDaemonChild) {
      console.error(chalk.red('Failed to start gateway:'), error);
    }
    process.exit(1);
  }
}

gatewayCommand
  .command('status')
  .description('Check Gateway server status')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .action(async (options) => {
    const { host, port } = options;

    // First check PID file
    const pidInfo = readPidFile();
    if (pidInfo) {
      if (isProcessRunning(pidInfo.pid)) {
        console.log(chalk.green('✓ Gateway process is running'));
        console.log(chalk.gray(`  PID: ${pidInfo.pid}`));
        console.log(chalk.gray(`  Mode: ${pidInfo.mode || 'foreground'}`));
        console.log(chalk.gray(`  Address: ws://${pidInfo.host}:${pidInfo.port}`));
        console.log(chalk.gray(`  Database: ${pidInfo.dbPath}`));
        console.log(chalk.gray(`  Started: ${new Date(pidInfo.startedAt).toISOString()}`));
        console.log(chalk.gray(`  Uptime: ${formatUptime(Date.now() - pidInfo.startedAt)}`));

        // Check daemon status
        if (pidInfo.daemonPid) {
          if (isProcessRunning(pidInfo.daemonPid)) {
            console.log(chalk.gray(`  Daemon PID: ${pidInfo.daemonPid} (running)`));
          } else {
            console.log(chalk.yellow(`  Daemon PID: ${pidInfo.daemonPid} (not running)`));
          }
        }
      } else {
        console.log(chalk.yellow('⚠ Stale PID file found (process not running)'));
        removePidFile();
      }
    } else {
      console.log(chalk.gray('No PID file found'));
    }

    // Also try to connect
    const url = `ws://${host}:${port}`;
    console.log(chalk.blue(`\nChecking Gateway connectivity at ${url}...`));

    try {
      // Try to connect with a simple WebSocket
      const { WebSocket } = await import('ws');

      const ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        ws.close();
        console.log(chalk.red('✗ Gateway not responding (timeout)'));
        process.exit(1);
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        // Send a ping request
        ws.send(JSON.stringify({
          type: 'req',
          id: 'status-check',
          method: 'system.ping',
        }));
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.type === 'res' && response.result?.pong) {
            console.log(chalk.green('✓ Gateway is responding'));
            console.log(chalk.gray(`  Server time: ${new Date(response.result.timestamp).toISOString()}`));
            ws.close();
            process.exit(0);
          }
        } catch {
          // Ignore parse errors
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log(chalk.red('✗ Gateway not reachable'));
        console.log(chalk.gray(`  Error: ${error.message}`));
        process.exit(1);
      });

      ws.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 1000) {
          console.log(chalk.yellow(`Connection closed with code ${code}`));
        }
      });
    } catch (error) {
      console.error(chalk.red('Failed to check status:'), error);
      process.exit(1);
    }
  });

gatewayCommand
  .command('stop')
  .description('Stop the running Gateway server')
  .option('-p, --port <port>', 'Port to check for running process', String(DEFAULT_PORT))
  .option('-f, --force', 'Force kill with SIGKILL')
  .action(async (options) => {
    const { port, force } = options;

    let targetPid: number | null = null;
    let daemonPid: number | null = null;
    let fromPidFile = false;

    // First check PID file
    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      targetPid = pidInfo.pid;
      daemonPid = pidInfo.daemonPid || null;
      fromPidFile = true;
    }

    // Also check daemon PID file
    if (!daemonPid) {
      daemonPid = readDaemonPidFile();
    }

    // If no PID from file, check by port
    if (!targetPid) {
      const portPid = findProcessByPort(parseInt(port, 10));
      if (portPid) {
        targetPid = portPid;
        console.log(chalk.yellow(`Found process on port ${port} (PID: ${portPid})`));
      }
    }

    if (!targetPid && !daemonPid) {
      console.log(chalk.yellow('No Gateway process found'));
      removePidFile();
      removeDaemonPidFile();
      process.exit(0);
    }

    const signal = force ? 'SIGKILL' : 'SIGTERM';

    // Stop daemon first (so it doesn't restart the gateway)
    if (daemonPid && isProcessRunning(daemonPid)) {
      console.log(chalk.blue(`Stopping daemon (PID: ${daemonPid})...`));
      killProcess(daemonPid, signal);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Stop gateway
    if (targetPid) {
      console.log(chalk.blue(`Stopping Gateway (PID: ${targetPid})...`));

      if (killProcess(targetPid, signal)) {
        // Wait for process to stop
        let attempts = 0;
        const maxAttempts = force ? 5 : 30;

        while (attempts < maxAttempts && isProcessRunning(targetPid)) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        if (isProcessRunning(targetPid)) {
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
    }

    if (fromPidFile) {
      removePidFile();
    }
    removeDaemonPidFile();
    console.log(chalk.green('✓ Gateway stopped'));
  });

gatewayCommand
  .command('ps')
  .description('Show running Gateway process information')
  .option('-p, --port <port>', 'Port to check for running process', String(DEFAULT_PORT))
  .action(async (options) => {
    const { port } = options;
    const pidInfo = readPidFile();

    // Check PID file first
    if (pidInfo) {
      const running = isProcessRunning(pidInfo.pid);
      const daemonRunning = pidInfo.daemonPid ? isProcessRunning(pidInfo.daemonPid) : false;

      console.log(chalk.blue('\nGateway Process Info:\n'));
      console.log(chalk.white('  Status:'), running ? chalk.green('Running') : chalk.red('Not Running'));
      console.log(chalk.white('  PID:'), chalk.cyan(pidInfo.pid));
      console.log(chalk.white('  Mode:'), chalk.cyan(pidInfo.mode || 'foreground'));
      console.log(chalk.white('  Address:'), chalk.cyan(`ws://${pidInfo.host}:${pidInfo.port}`));
      console.log(chalk.white('  Database:'), chalk.gray(pidInfo.dbPath));
      console.log(chalk.white('  Started:'), chalk.gray(new Date(pidInfo.startedAt).toISOString()));

      if (running) {
        console.log(chalk.white('  Uptime:'), chalk.gray(formatUptime(Date.now() - pidInfo.startedAt)));
      }

      if (pidInfo.daemonPid) {
        console.log(chalk.white('  Daemon PID:'), daemonRunning
          ? chalk.green(`${pidInfo.daemonPid} (running)`)
          : chalk.red(`${pidInfo.daemonPid} (not running)`));
      }

      console.log(chalk.white('  Log file:'), chalk.gray(LOG_FILE));

      if (!running) {
        console.log(chalk.yellow('\n⚠ Process is not running but PID file exists'));
        if (daemonRunning) {
          console.log(chalk.gray('  Daemon should restart it automatically'));
        } else {
          console.log(chalk.gray('  Run `pb gateway start` to start a new instance'));
        }
      }
      console.log();
      return;
    }

    // No PID file, check by port
    const portPid = findProcessByPort(parseInt(port, 10));
    if (portPid) {
      console.log(chalk.blue('\nGateway Process Info (from port scan):\n'));
      console.log(chalk.white('  Status:'), chalk.green('Running'));
      console.log(chalk.white('  PID:'), chalk.cyan(portPid));
      console.log(chalk.white('  Port:'), chalk.cyan(port));
      console.log(chalk.yellow('\n⚠ No PID file found - process may have been started externally'));
      console.log(chalk.gray('  Run `pb gateway stop` to stop this process'));
      console.log();
      return;
    }

    console.log(chalk.yellow('No Gateway process found'));
  });

// Add logs command
gatewayCommand
  .command('logs')
  .description('Show Gateway logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action(async (options) => {
    const { follow, lines } = options;

    if (!existsSync(LOG_FILE)) {
      console.log(chalk.yellow('No log file found'));
      process.exit(0);
    }

    if (follow) {
      // Use tail -f
      const tail = spawn('tail', ['-f', LOG_FILE], {
        stdio: 'inherit',
      });

      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    } else {
      // Show last N lines
      try {
        const output = execSync(`tail -n ${lines} "${LOG_FILE}"`, { encoding: 'utf-8' });
        console.log(output);
      } catch {
        console.log(chalk.red('Failed to read log file'));
      }
    }
  });

gatewayCommand
  .command('pair')
  .description('Generate a pairing token for client authentication')
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .option('-p, --permissions <perms>', 'Comma-separated permissions (read,write,admin)', 'read,write')
  .option('-e, --expires <hours>', 'Token expiration in hours (0 = never)', '24')
  .action(async (options) => {
    const { db: dbPath, permissions: permsStr, expires } = options;

    try {
      // Parse permissions
      const permissions = permsStr.split(',').map((p: string) => p.trim()) as Permission[];
      const validPerms: Permission[] = ['read', 'write', 'admin'];
      for (const perm of permissions) {
        if (!validPerms.includes(perm)) {
          console.error(chalk.red(`Invalid permission: ${perm}`));
          console.log(chalk.gray(`Valid permissions: ${validPerms.join(', ')}`));
          process.exit(1);
        }
      }

      // Calculate expiration
      const expiresHours = parseInt(expires, 10);
      const expiresInMs = expiresHours > 0 ? expiresHours * 60 * 60 * 1000 : undefined;

      // Initialize database
      const db = new Database(dbPath);

      // Load schema
      const schemaPath = join(__dirname, '../../infra/persistence/schema.sql');
      try {
        const schema = readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
      } catch {
        const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema.sql');
        const schema = readFileSync(distSchemaPath, 'utf-8');
        db.exec(schema);
      }

      // Create token using PairingTokenStore directly
      const { PairingTokenStore } = await import('../../gateway/auth/pairing-token-store.js');
      const tokenStore = new PairingTokenStore(db);
      const { token, id } = tokenStore.createToken(permissions, expiresInMs);

      console.log(chalk.green('\n✓ Pairing token created\n'));
      console.log(chalk.white('Token ID:'), chalk.cyan(id));
      console.log(chalk.white('Token:'), chalk.yellow(token));
      console.log(chalk.white('Permissions:'), chalk.gray(permissions.join(', ')));
      if (expiresInMs) {
        const expiresAt = new Date(Date.now() + expiresInMs);
        console.log(chalk.white('Expires:'), chalk.gray(expiresAt.toISOString()));
      } else {
        console.log(chalk.white('Expires:'), chalk.gray('Never'));
      }

      console.log(chalk.yellow('\n⚠ Save this token securely - it cannot be retrieved later!\n'));

      db.close();
    } catch (error) {
      console.error(chalk.red('Failed to create pairing token:'), error);
      process.exit(1);
    }
  });

gatewayCommand
  .command('tokens')
  .description('List active pairing tokens')
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .action(async (options) => {
    const { db: dbPath } = options;

    try {
      const db = new Database(dbPath);

      // Load schema
      const schemaPath = join(__dirname, '../../infra/persistence/schema.sql');
      try {
        const schema = readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
      } catch {
        const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema.sql');
        const schema = readFileSync(distSchemaPath, 'utf-8');
        db.exec(schema);
      }

      const { PairingTokenStore } = await import('../../gateway/auth/pairing-token-store.js');
      const tokenStore = new PairingTokenStore(db);
      const tokens = tokenStore.listActiveTokens();

      if (tokens.length === 0) {
        console.log(chalk.yellow('No active pairing tokens'));
      } else {
        console.log(chalk.blue(`\nActive Pairing Tokens (${tokens.length}):\n`));

        for (const token of tokens) {
          const paired = token.publicKey ? chalk.green('✓ Paired') : chalk.gray('○ Unpaired');
          const expires = token.expiresAt
            ? new Date(token.expiresAt).toISOString()
            : 'Never';

          console.log(chalk.white(`  ${token.id}`));
          console.log(chalk.gray(`    Status: ${paired}`));
          console.log(chalk.gray(`    Permissions: ${token.permissions.join(', ')}`));
          console.log(chalk.gray(`    Created: ${new Date(token.createdAt).toISOString()}`));
          console.log(chalk.gray(`    Expires: ${expires}`));
          if (token.publicKey) {
            console.log(chalk.gray(`    Public Key: ${token.publicKey.slice(0, 16)}...`));
          }
          console.log();
        }
      }

      db.close();
    } catch (error) {
      console.error(chalk.red('Failed to list tokens:'), error);
      process.exit(1);
    }
  });

gatewayCommand
  .command('revoke <tokenId>')
  .description('Revoke a pairing token')
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .action(async (tokenId, options) => {
    const { db: dbPath } = options;

    try {
      const db = new Database(dbPath);

      // Load schema
      const schemaPath = join(__dirname, '../../infra/persistence/schema.sql');
      try {
        const schema = readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
      } catch {
        const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema.sql');
        const schema = readFileSync(distSchemaPath, 'utf-8');
        db.exec(schema);
      }

      const { PairingTokenStore } = await import('../../gateway/auth/pairing-token-store.js');
      const tokenStore = new PairingTokenStore(db);
      const revoked = tokenStore.revokeToken(tokenId);

      if (revoked) {
        console.log(chalk.green(`✓ Token ${tokenId} revoked`));
      } else {
        console.log(chalk.yellow(`Token ${tokenId} not found or already revoked`));
      }

      db.close();
    } catch (error) {
      console.error(chalk.red('Failed to revoke token:'), error);
      process.exit(1);
    }
  });

gatewayCommand
  .command('tui')
  .description('Start the Gateway TUI (Terminal User Interface)')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-t, --token <token>', 'Authentication token')
  .action(async (options) => {
    const { host, port, token } = options;
    const url = `ws://${host}:${port}`;

    console.log(chalk.blue(`Connecting to Gateway at ${url}...`));

    try {
      await startGatewayTui({ url, token });
    } catch (error) {
      console.error(chalk.red('TUI error:'), error);
      process.exit(1);
    }
  });
