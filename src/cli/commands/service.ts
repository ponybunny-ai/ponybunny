/**
 * Service Management CLI Command
 *
 * Unified interface for managing all PonyBunny services:
 * - Gateway (WebSocket server)
 * - Scheduler (autonomous execution daemon)
 * - Debug Server (observability web UI)
 * - Web UI (main application)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PONY_DIR = join(homedir(), '.ponybunny');
const SERVICES_STATE_FILE = join(PONY_DIR, 'services.json');
function resolveServiceDbPath(): string {
  return resolve(loadRuntimeConfig().paths.database);
}

interface ServiceInfo {
  name: string;
  pid: number;
  port?: number;
  host?: string;
  startedAt: number;
  mode: 'foreground' | 'background' | 'daemon';
  dbPath?: string;
  logFile?: string;
}

interface ServicesState {
  gateway?: ServiceInfo;
  scheduler?: ServiceInfo;
  debugServer?: ServiceInfo;
  webui?: ServiceInfo;
}

function ensurePonyDir(): void {
  if (!existsSync(PONY_DIR)) {
    mkdirSync(PONY_DIR, { recursive: true });
  }
}

function readServicesState(): ServicesState {
  try {
    if (!existsSync(SERVICES_STATE_FILE)) {
      return {};
    }
    return JSON.parse(readFileSync(SERVICES_STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeServicesState(state: ServicesState): void {
  ensurePonyDir();
  writeFileSync(SERVICES_STATE_FILE, JSON.stringify(state, null, 2));
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

export const serviceCommand = new Command('service')
  .description('Manage all PonyBunny services');

// pb service status - Show status of all services
serviceCommand
  .command('status')
  .description('Show status of all services')
  .action(() => {
    console.log(chalk.blue('\n╔═══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.blue('║           PonyBunny Services Status                           ║'));
    console.log(chalk.blue('╚═══════════════════════════════════════════════════════════════╝\n'));

    // Gateway - check actual PID file
    console.log(chalk.white('  Gateway:'));
    try {
      const gatewayPidFile = join(PONY_DIR, 'gateway.pid');
      if (existsSync(gatewayPidFile)) {
        const gatewayPid = JSON.parse(readFileSync(gatewayPidFile, 'utf-8'));
        if (isProcessRunning(gatewayPid.pid)) {
          console.log(chalk.green('    ✓ Running'));
          console.log(chalk.gray(`    PID: ${gatewayPid.pid}`));
          console.log(chalk.gray(`    Address: ws://${gatewayPid.host}:${gatewayPid.port}`));
          console.log(chalk.gray(`    Uptime: ${formatUptime(Date.now() - gatewayPid.startedAt)}`));
          console.log(chalk.gray(`    Mode: ${gatewayPid.mode}`));
        } else {
          console.log(chalk.red('    ✗ Not running'));
          console.log(chalk.gray('    Start: pb service start gateway'));
        }
      } else {
        console.log(chalk.red('    ✗ Not running'));
        console.log(chalk.gray('    Start: pb service start gateway'));
      }
    } catch {
      console.log(chalk.red('    ✗ Not running'));
      console.log(chalk.gray('    Start: pb service start gateway'));
    }

    // Scheduler - check actual PID file
    console.log(chalk.white('\n  Scheduler:'));
    try {
      const schedulerPidFile = join(PONY_DIR, 'scheduler.pid');
      if (existsSync(schedulerPidFile)) {
        const schedulerPid = JSON.parse(readFileSync(schedulerPidFile, 'utf-8'));
        if (isProcessRunning(schedulerPid.pid)) {
          console.log(chalk.green('    ✓ Running'));
          console.log(chalk.gray(`    PID: ${schedulerPid.pid}`));
          console.log(chalk.gray(`    Uptime: ${formatUptime(Date.now() - schedulerPid.startedAt)}`));
        } else {
          console.log(chalk.red('    ✗ Not running'));
          console.log(chalk.gray('    Start: pb service start scheduler'));
        }
      } else {
        console.log(chalk.red('    ✗ Not running'));
        console.log(chalk.gray('    Start: pb service start scheduler'));
      }
    } catch {
      console.log(chalk.red('    ✗ Not running'));
      console.log(chalk.gray('    Start: pb service start scheduler'));
    }

    // Debug Server - check actual PID file
    console.log(chalk.white('\n  Debug Server:'));
    try {
      const debugPidFile = join(PONY_DIR, 'debug-server.pid');
      if (existsSync(debugPidFile)) {
        const debugPid = JSON.parse(readFileSync(debugPidFile, 'utf-8'));
        if (isProcessRunning(debugPid.pid)) {
          console.log(chalk.green('    ✓ Running'));
          console.log(chalk.gray(`    PID: ${debugPid.pid}`));
          console.log(chalk.gray(`    Address: http://localhost:${debugPid.port || 3001}`));
          console.log(chalk.gray(`    Uptime: ${formatUptime(Date.now() - debugPid.startedAt)}`));
        } else {
          console.log(chalk.red('    ✗ Not running'));
          console.log(chalk.gray('    Start: pb service start debug'));
        }
      } else {
        console.log(chalk.red('    ✗ Not running'));
        console.log(chalk.gray('    Start: pb service start debug'));
      }
    } catch {
      console.log(chalk.red('    ✗ Not running'));
      console.log(chalk.gray('    Start: pb service start debug'));
    }

    // Web UI
    console.log(chalk.white('\n  Web UI:'));
    console.log(chalk.red('    ✗ Not running'));
    console.log(chalk.gray('    Start: pb service start web'));

    console.log();
  });

// pb service start <service> - Start a specific service
serviceCommand
  .command('start <service>')
  .description('Start a service (gateway|scheduler|debug|web|all)')
  .option('--foreground', 'Run in foreground')
  .action(async (serviceName: string, options) => {
    const { foreground } = options;

    if (serviceName === 'all') {
      console.log(chalk.blue('Starting all services...\n'));
      await startService('gateway', foreground);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await startService('scheduler', foreground);
      console.log(chalk.green('\n✓ All services started'));
      console.log(chalk.gray('\nNote: Debug Server not started (use `pb debug web` to start manually)'));
      return;
    }

    await startService(serviceName, foreground);
  });

async function startService(serviceName: string, foreground: boolean = false): Promise<void> {
  const dbPath = resolveServiceDbPath();

  switch (serviceName) {
    case 'gateway':
      console.log(chalk.blue('Starting Gateway...'));
      try {
        if (foreground) {
          spawn('pb', ['gateway', 'start', '--foreground', '--db', dbPath], { stdio: 'inherit' });
        } else {
          execSync(`pb gateway start --db "${dbPath}"`, { stdio: 'inherit' });
        }
      } catch (error: any) {
        // Gateway command handles its own error messages
        // Just check if it's already running
        if (error.status === 1) {
          console.log(chalk.gray('  (skipping, may already be running)'));
        } else {
          throw error;
        }
      }
      break;

    case 'scheduler':
      console.log(chalk.blue('Starting Scheduler...'));
      try {
        if (foreground) {
          spawn('pb', ['scheduler', 'start', '--foreground', '--db', dbPath], { stdio: 'inherit' });
        } else {
          execSync(`pb scheduler start --db "${dbPath}"`, { stdio: 'inherit' });
        }
      } catch (error: any) {
        if (error.status === 1) {
          console.log(chalk.gray('  (skipping, may already be running)'));
        } else {
          throw error;
        }
      }
      break;

    case 'debug':
      console.log(chalk.blue('Starting Debug Server...'));
      try {
        execSync('pb debug web', { stdio: 'inherit' });
      } catch (error: any) {
        if (error.status === 1) {
          console.log(chalk.gray('  (skipping, may already be running)'));
        } else {
          throw error;
        }
      }
      break;

    case 'web':
      console.log(chalk.blue('Starting Web UI...'));
      // TODO: Implement web UI dev server start
      console.log(chalk.yellow('Web UI dev server not yet implemented'));
      console.log(chalk.gray('Run manually: cd web && npm run dev'));
      break;

    default:
      console.log(chalk.red(`Unknown service: ${serviceName}`));
      console.log(chalk.gray('Available services: gateway, scheduler, debug, web, all'));
      process.exit(1);
  }
}

// pb service stop <service> - Stop a specific service
serviceCommand
  .command('stop <service>')
  .description('Stop a service (gateway|scheduler|debug|web|all)')
  .option('-f, --force', 'Force kill with SIGKILL')
  .action(async (serviceName: string, options) => {
    const { force } = options;

    if (serviceName === 'all') {
      console.log(chalk.blue('Stopping all services...\n'));
      await stopService('scheduler', force);
      await stopService('gateway', force);
      console.log(chalk.green('\n✓ All services stopped'));
      console.log(chalk.gray('\nNote: Debug Server not managed by service command (stop manually if running)'));
      return;
    }

    await stopService(serviceName, force);
  });

async function stopService(serviceName: string, force: boolean = false): Promise<void> {
  switch (serviceName) {
    case 'gateway':
      console.log(chalk.blue('Stopping Gateway...'));
      try {
        execSync(`pb gateway stop ${force ? '--force' : ''}`, { stdio: 'inherit' });
      } catch (error: any) {
        if (error.status === 1) {
          console.log(chalk.gray('  (already stopped or not running)'));
        } else {
          throw error;
        }
      }
      break;

    case 'scheduler':
      console.log(chalk.blue('Stopping Scheduler...'));
      try {
        execSync(`pb scheduler stop ${force ? '--force' : ''}`, { stdio: 'inherit' });
      } catch (error: any) {
        if (error.status === 1) {
          console.log(chalk.gray('  (already stopped or not running)'));
        } else {
          throw error;
        }
      }
      break;

    case 'debug':
      console.log(chalk.gray('Debug Server is not managed by service command'));
      console.log(chalk.gray('Stop manually if running'));
      break;

    case 'web':
      console.log(chalk.gray('Web UI is not managed by service command'));
      console.log(chalk.gray('Stop manually if running'));
      break;

    default:
      console.log(chalk.red(`Unknown service: ${serviceName}`));
      process.exit(1);
  }
}

// pb service restart <service> - Restart a service
serviceCommand
  .command('restart <service>')
  .description('Restart a service (gateway|scheduler|debug|web|all)')
  .action(async (serviceName: string) => {
    console.log(chalk.blue(`Restarting ${serviceName}...\n`));
    await stopService(serviceName);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await startService(serviceName);
  });

// pb service logs <service> - Show service logs
serviceCommand
  .command('logs <service>')
  .description('Show service logs (gateway|scheduler|debug)')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action((serviceName: string, options) => {
    const { follow, lines } = options;

    let logFile: string;
    switch (serviceName) {
      case 'gateway':
        logFile = join(PONY_DIR, 'gateway.log');
        break;
      case 'scheduler':
        logFile = join(PONY_DIR, 'scheduler.log');
        break;
      case 'debug':
        logFile = join(PONY_DIR, 'debug-server.log');
        break;
      default:
        console.log(chalk.red(`Unknown service: ${serviceName}`));
        console.log(chalk.gray('Available services: gateway, scheduler, debug'));
        process.exit(1);
    }

    if (!existsSync(logFile)) {
      console.log(chalk.yellow(`No log file found for ${serviceName}`));
      process.exit(0);
    }

    if (follow) {
      const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    } else {
      try {
        const output = execSync(`tail -n ${lines} "${logFile}"`, { encoding: 'utf-8' });
        console.log(output);
      } catch {
        console.log(chalk.red('Failed to read log file'));
      }
    }
  });

// pb service ps - Show detailed process information
serviceCommand
  .command('ps')
  .description('Show detailed process information for all services')
  .action(() => {
    const state = readServicesState();

    console.log(chalk.blue('\n╔═══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.blue('║           PonyBunny Process Information                       ║'));
    console.log(chalk.blue('╚═══════════════════════════════════════════════════════════════╝\n'));

    const services = [
      { name: 'Gateway', info: state.gateway },
      { name: 'Scheduler', info: state.scheduler },
      { name: 'Debug Server', info: state.debugServer },
      { name: 'Web UI', info: state.webui },
    ];

    for (const service of services) {
      console.log(chalk.white(`  ${service.name}:`));

      if (service.info && isProcessRunning(service.info.pid)) {
        console.log(chalk.green('    Status: Running'));
        console.log(chalk.gray(`    PID: ${service.info.pid}`));
        console.log(chalk.gray(`    Mode: ${service.info.mode}`));
        console.log(chalk.gray(`    Started: ${new Date(service.info.startedAt).toISOString()}`));
        console.log(chalk.gray(`    Uptime: ${formatUptime(Date.now() - service.info.startedAt)}`));

        if (service.info.host && service.info.port) {
          const protocol = service.name === 'Gateway' ? 'ws' : 'http';
          console.log(chalk.gray(`    Address: ${protocol}://${service.info.host}:${service.info.port}`));
        }

        if (service.info.dbPath) {
          console.log(chalk.gray(`    Database: ${service.info.dbPath}`));
        }

        if (service.info.logFile) {
          console.log(chalk.gray(`    Log: ${service.info.logFile}`));
        }
      } else {
        console.log(chalk.red('    Status: Not running'));
      }

      console.log();
    }
  });
