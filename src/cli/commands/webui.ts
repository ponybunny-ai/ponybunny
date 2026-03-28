/**
 * WebUI CLI Commands
 *
 * Manages the PonyBunny Web UI (Next.js) as a background service,
 * following the same PID-file pattern used by `pb gateway`.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
} from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { spawn, execSync } from 'child_process';

// Directories
const PONY_DIR = join(homedir(), '.ponybunny');
const PID_FILE = join(PONY_DIR, 'webui.pid');
const LOG_FILE = join(PONY_DIR, 'webui.log');

const DEFAULT_PORT = 3000;

interface PidInfo {
  pid: number;
  port: number;
  startedAt: number;
  webDir: string;
  mode: 'development' | 'production';
}

// ---------------------------------------------------------------------------
// Helpers (aligned with gateway.ts conventions)
// ---------------------------------------------------------------------------

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
    if (!existsSync(PID_FILE)) return null;
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // ignore
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
    return pids.length > 0 ? parseInt(pids[0], 10) : null;
  } catch {
    return null;
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Resolve the absolute path to the `web/` directory.
 * Works from both the source tree and a packaged dist/ layout.
 */
function resolveWebDir(): string {
  // Try repo-relative first (dev mode)
  const candidates = [
    join(process.cwd(), 'web'),
    resolve(join(import.meta.dirname ?? '.', '../../../web')),
    resolve(join(import.meta.dirname ?? '.', '../../../../web')),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return join(process.cwd(), 'web'); // fallback, start will fail gracefully
}

// ---------------------------------------------------------------------------
// Command definition
// ---------------------------------------------------------------------------

export const webuiCommand = new Command('webui')
  .description('Manage Web UI service');

webuiCommand
  .command('start')
  .description('Start the Web UI (Next.js) server')
  .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .option('--prod', 'Run production build (next start) instead of dev server')
  .option('--foreground', 'Run in foreground instead of background')
  .option('-f, --force', 'Force start even if another instance is running')
  .action(async (options) => {
    const { port: portStr, prod, foreground, force } = options;
    const port = parseInt(portStr, 10);
    const webDir = resolveWebDir();

    // Validate web directory
    if (!existsSync(join(webDir, 'package.json'))) {
      console.error(chalk.red('Web UI directory not found or missing package.json'));
      console.log(chalk.gray(`  Expected: ${webDir}`));
      console.log(chalk.gray('  Run from the repository root, or install the web/ dependencies.'));
      process.exit(1);
    }

    // Check for existing instance
    const existing = readPidFile();
    if (existing && isProcessRunning(existing.pid)) {
      if (!force) {
        console.log(chalk.yellow('Web UI is already running'));
        console.log(chalk.gray(`  PID: ${existing.pid}`));
        console.log(chalk.gray(`  Port: ${existing.port}`));
        console.log(chalk.gray(`  Started: ${new Date(existing.startedAt).toISOString()}`));
        console.log(chalk.gray('\nUse --force to start anyway, or run `pb webui stop` first'));
        process.exit(1);
      }
      console.log(chalk.yellow('Stopping existing Web UI process...'));
      killProcess(existing.pid);
      await new Promise(r => setTimeout(r, 1000));
    }

    removePidFile();

    const mode: 'development' | 'production' = prod ? 'production' : 'development';
    const npmScript = prod ? 'start' : 'dev';

    // Check if production build exists when using --prod
    if (prod && !existsSync(join(webDir, '.next'))) {
      console.log(chalk.yellow('No production build found. Building first...'));
      try {
        execSync('npm run build', { cwd: webDir, stdio: 'inherit' });
      } catch {
        console.error(chalk.red('Build failed. Fix errors and try again.'));
        process.exit(1);
      }
    }

    if (foreground) {
      // Foreground mode — inherit stdio
      console.log(chalk.blue(`Starting Web UI in foreground (${mode})...`));
      console.log(chalk.gray(`  Directory: ${webDir}`));
      console.log(chalk.gray(`  Port: ${port}`));
      console.log(chalk.gray('\nPress Ctrl+C to stop\n'));

      const child = spawn('npm', ['run', npmScript, '--', '-p', String(port)], {
        cwd: webDir,
        stdio: 'inherit',
        env: { ...process.env, PORT: String(port) },
      });

      writePidFile({ pid: child.pid!, port, startedAt: Date.now(), webDir, mode });

      const cleanup = () => {
        removePidFile();
        child.kill('SIGTERM');
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      child.on('exit', (code) => {
        removePidFile();
        process.exit(code ?? 0);
      });

      // Keep alive
      await new Promise(() => {});
    } else {
      // Background mode (default)
      console.log(chalk.blue(`Starting Web UI in background (${mode})...`));

      ensurePonyDir();
      const logFd = openSync(LOG_FILE, 'a');

      const child = spawn('npm', ['run', npmScript, '--', '-p', String(port)], {
        cwd: webDir,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PORT: String(port) },
      });

      child.unref();
      closeSync(logFd);

      // Write PID immediately (we know the child PID)
      writePidFile({ pid: child.pid!, port, startedAt: Date.now(), webDir, mode });

      // Give the server a moment to start, then confirm
      await new Promise(r => setTimeout(r, 2000));

      if (isProcessRunning(child.pid!)) {
        console.log(chalk.green('\nWeb UI started in background'));
        console.log(chalk.gray(`  PID: ${child.pid}`));
        console.log(chalk.gray(`  URL: http://localhost:${port}`));
        console.log(chalk.gray(`  Mode: ${mode}`));
        console.log(chalk.gray(`  Directory: ${webDir}`));
        console.log(chalk.gray(`  Log: ${LOG_FILE}`));
        console.log(chalk.gray('\nUse `pb webui stop` to stop the server'));
      } else {
        removePidFile();
        console.log(chalk.red('Failed to start Web UI. Check logs:'));
        console.log(chalk.gray(`  ${LOG_FILE}`));
        process.exit(1);
      }
    }
  });

webuiCommand
  .command('stop')
  .description('Stop the running Web UI server')
  .option('-p, --port <port>', 'Port to check for running process', String(DEFAULT_PORT))
  .option('-f, --force', 'Force kill with SIGKILL')
  .action(async (options) => {
    const { port, force } = options;
    let targetPid: number | null = null;
    let fromPidFile = false;

    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      targetPid = pidInfo.pid;
      fromPidFile = true;
    }

    if (!targetPid) {
      const portPid = findProcessByPort(parseInt(port, 10));
      if (portPid) {
        targetPid = portPid;
        console.log(chalk.yellow(`Found process on port ${port} (PID: ${portPid})`));
      }
    }

    if (!targetPid) {
      console.log(chalk.yellow('No Web UI process found'));
      removePidFile();
      process.exit(0);
    }

    const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM';
    console.log(chalk.blue(`Stopping Web UI (PID: ${targetPid})...`));

    if (killProcess(targetPid, signal)) {
      let attempts = 0;
      const maxAttempts = force ? 5 : 30;
      while (attempts < maxAttempts && isProcessRunning(targetPid)) {
        await new Promise(r => setTimeout(r, 100));
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

    if (fromPidFile) removePidFile();
    console.log(chalk.green('Web UI stopped'));
  });

webuiCommand
  .command('restart')
  .description('Restart the Web UI server')
  .option('-p, --port <port>', 'Port to listen on', String(DEFAULT_PORT))
  .option('--prod', 'Run production build')
  .action(async (options) => {
    const { port, prod } = options;

    // Stop if running
    const pidInfo = readPidFile();
    if (pidInfo && isProcessRunning(pidInfo.pid)) {
      console.log(chalk.blue(`Stopping Web UI (PID: ${pidInfo.pid})...`));
      killProcess(pidInfo.pid);
      let attempts = 0;
      while (attempts < 30 && isProcessRunning(pidInfo.pid)) {
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }
      removePidFile();
    }

    // Re-invoke start in background
    const webDir = resolveWebDir();
    const mode: 'development' | 'production' = prod ? 'production' : 'development';
    const npmScript = prod ? 'start' : 'dev';
    const portNum = parseInt(port, 10);

    if (!existsSync(join(webDir, 'package.json'))) {
      console.error(chalk.red('Web UI directory not found'));
      process.exit(1);
    }

    console.log(chalk.blue(`Starting Web UI (${mode})...`));

    ensurePonyDir();
    const logFd = openSync(LOG_FILE, 'a');

    const child = spawn('npm', ['run', npmScript, '--', '-p', String(portNum)], {
      cwd: webDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, PORT: String(portNum) },
    });

    child.unref();
    closeSync(logFd);

    writePidFile({ pid: child.pid!, port: portNum, startedAt: Date.now(), webDir, mode });

    await new Promise(r => setTimeout(r, 2000));

    if (isProcessRunning(child.pid!)) {
      console.log(chalk.green('Web UI restarted'));
      console.log(chalk.gray(`  PID: ${child.pid}`));
      console.log(chalk.gray(`  URL: http://localhost:${portNum}`));
    } else {
      removePidFile();
      console.log(chalk.red('Failed to restart Web UI. Check logs:'));
      console.log(chalk.gray(`  ${LOG_FILE}`));
      process.exit(1);
    }
  });

webuiCommand
  .command('status')
  .description('Show Web UI service status')
  .option('-p, --port <port>', 'Port to check', String(DEFAULT_PORT))
  .action(async (options) => {
    const { port } = options;
    const pidInfo = readPidFile();

    if (pidInfo) {
      if (isProcessRunning(pidInfo.pid)) {
        const uptime = formatUptime(Date.now() - pidInfo.startedAt);
        console.log(chalk.green('Web UI is running'));
        console.log(chalk.gray(`  PID: ${pidInfo.pid}`));
        console.log(chalk.gray(`  URL: http://localhost:${pidInfo.port}`));
        console.log(chalk.gray(`  Mode: ${pidInfo.mode}`));
        console.log(chalk.gray(`  Directory: ${pidInfo.webDir}`));
        console.log(chalk.gray(`  Started: ${new Date(pidInfo.startedAt).toISOString()}`));
        console.log(chalk.gray(`  Uptime: ${uptime}`));
        console.log(chalk.gray(`  Log: ${LOG_FILE}`));
        return;
      } else {
        console.log(chalk.yellow('Stale PID file found (process not running)'));
        removePidFile();
      }
    }

    // Fallback: check by port
    const portPid = findProcessByPort(parseInt(port, 10));
    if (portPid) {
      console.log(chalk.yellow(`Process found on port ${port} (PID: ${portPid}) — no PID file`));
      console.log(chalk.gray('It may have been started outside of `pb webui start`'));
      return;
    }

    console.log(chalk.gray('Web UI is not running'));
  });

webuiCommand
  .command('logs')
  .description('Show Web UI logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action(async (options) => {
    const { follow, lines } = options;

    if (!existsSync(LOG_FILE)) {
      console.log(chalk.yellow('No log file found'));
      process.exit(0);
    }

    if (follow) {
      const tail = spawn('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
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
  });
