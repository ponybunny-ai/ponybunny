/**
 * Debug CLI Command - Launch the debug/observability TUI or Web UI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { startDebugTui } from '../debug-tui/index.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { ensureMainSchema } from '../../infra/persistence/ensure-schema.js';

const runtimeConfig = loadRuntimeConfig();
const DEFAULT_HOST = runtimeConfig.gateway.host;
const DEFAULT_PORT = runtimeConfig.gateway.port;
const DEFAULT_DB_PATH = runtimeConfig.paths.database;
const DEFAULT_DEBUG_SERVER_PORT = runtimeConfig.debug.serverPort;

const PONY_DIR = join(homedir(), '.ponybunny');
const DEBUG_CONFIG_FILE = join(PONY_DIR, 'debug-config.json');
const DEBUG_SERVER_PID_FILE = join(PONY_DIR, 'debug-server.pid');
const DEBUG_SERVER_LOG_FILE = join(PONY_DIR, 'debug-server.log');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DebugConfig {
  adminToken?: string;
  tokenId?: string;
  createdAt?: number;
}

interface DebugServerPidInfo {
  pid: number;
  host: string;
  gatewayPort: number;
  webPort: number;
  dbPath: string;
  debugDbPath: string;
  startedAt: number;
}

function ensurePonyDir(): void {
  if (!existsSync(PONY_DIR)) {
    mkdirSync(PONY_DIR, { recursive: true });
  }
}

function loadDebugConfig(): DebugConfig {
  try {
    if (existsSync(DEBUG_CONFIG_FILE)) {
      return JSON.parse(readFileSync(DEBUG_CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return {};
}

function saveDebugConfig(config: DebugConfig): void {
  ensurePonyDir();
  writeFileSync(DEBUG_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function readDebugServerPidInfo(): DebugServerPidInfo | null {
  try {
    if (!existsSync(DEBUG_SERVER_PID_FILE)) {
      return null;
    }
    return JSON.parse(readFileSync(DEBUG_SERVER_PID_FILE, 'utf-8')) as DebugServerPidInfo;
  } catch {
    return null;
  }
}

function writeDebugServerPidInfo(info: DebugServerPidInfo): void {
  ensurePonyDir();
  writeFileSync(DEBUG_SERVER_PID_FILE, JSON.stringify(info, null, 2));
}

function removeDebugServerPidInfo(): void {
  try {
    if (existsSync(DEBUG_SERVER_PID_FILE)) {
      unlinkSync(DEBUG_SERVER_PID_FILE);
    }
  } catch {
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

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function buildWebCommandArgs(options: {
  host: string;
  port: string;
  webPort: string;
  db: string;
  token?: string;
  debugDb: string;
}): string[] {
  const args = [
    'debug',
    'web',
    '--host',
    options.host,
    '--port',
    options.port,
    '--web-port',
    options.webPort,
    '--db',
    options.db,
    '--debug-db',
    options.debugDb,
    '--no-open',
  ];

  if (options.token) {
    args.push('--token', options.token);
  }

  return args;
}

async function stopDebugServerProcess(force: boolean): Promise<'stopped' | 'not_running'> {
  const info = readDebugServerPidInfo();
  if (!info || !isProcessRunning(info.pid)) {
    removeDebugServerPidInfo();
    return 'not_running';
  }

  const signal = force ? 'SIGKILL' : 'SIGTERM';
  if (!killProcess(info.pid, signal)) {
    throw new Error('Failed to send signal to Debug Server');
  }

  let attempts = 0;
  const maxAttempts = force ? 5 : 30;
  while (attempts < maxAttempts && isProcessRunning(info.pid)) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }

  if (isProcessRunning(info.pid)) {
    throw new Error('Debug Server did not stop');
  }

  removeDebugServerPidInfo();
  return 'stopped';
}

function startDebugServerProcess(options: {
  host: string;
  port: string;
  webPort: string;
  db: string;
  token?: string;
  debugDb: string;
}): { pid: number } {
  const existing = readDebugServerPidInfo();
  if (existing && isProcessRunning(existing.pid)) {
    return { pid: existing.pid };
  }

  const logFd = openSync(DEBUG_SERVER_LOG_FILE, 'a');
  const child = spawn('pb', buildWebCommandArgs(options), {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();

  if (!child.pid) {
    throw new Error('Failed to start Debug Server process');
  }

  writeDebugServerPidInfo({
    pid: child.pid,
    host: options.host,
    gatewayPort: parseInt(options.port, 10),
    webPort: parseInt(options.webPort, 10),
    dbPath: options.db,
    debugDbPath: options.debugDb,
    startedAt: Date.now(),
  });

  return { pid: child.pid };
}

async function getOrCreateAdminToken(dbPath: string): Promise<string> {
  const config = loadDebugConfig();

  // If we have a saved token, verify it's still valid
  if (config.adminToken && config.tokenId) {
    try {
      const db = new Database(dbPath);
      const row = db.prepare('SELECT * FROM pairing_tokens WHERE id = ? AND revoked_at IS NULL').get(config.tokenId) as unknown;
      db.close();

      if (row) {
        // Token still valid
        return config.adminToken;
      }
    } catch {
      // Token invalid or DB error, create new one
    }
  }

  // Create new admin token
  console.log(chalk.gray('Creating admin token for debug access...'));

  const { PairingTokenStore } = await import('../../gateway/auth/pairing-token-store.js');
  const db = new Database(dbPath);

  // Ensure schema exists
  ensureMainSchema(db);

  const tokenStore = new PairingTokenStore(db);
  const { token, id } = tokenStore.createToken(['read', 'write', 'admin']);
  db.close();

  // Save to config
  saveDebugConfig({
    adminToken: token,
    tokenId: id,
    createdAt: Date.now(),
  });

  console.log(chalk.green('✓ Admin token created and saved'));

  return token;
}

function getDebugServerPath(): string {
  // Check if running from dist or src
  const distPath = join(__dirname, '../../../../debug-server/server');
  const srcPath = join(__dirname, '../../../debug-server/server');

  if (existsSync(join(distPath, 'src/index.ts'))) {
    return distPath;
  }
  if (existsSync(join(srcPath, 'src/index.ts'))) {
    return srcPath;
  }

  // Fallback to relative from cwd
  return './debug-server/server';
}

// Shared TUI action handler
async function runTui(options: {
  host: string;
  port: string;
  db: string;
  token?: string;
}): Promise<void> {
  const { host, port, db: dbPath, token: providedToken } = options;
  const url = `ws://${host}:${port}`;

  try {
    // Get or create admin token
    const token = providedToken || await getOrCreateAdminToken(dbPath);

    console.log(chalk.blue(`Connecting to Gateway at ${url}...`));
    await startDebugTui({ url, token });
  } catch (error) {
    console.error(chalk.red('Debug TUI error:'), error);
    process.exit(1);
  }
}

// Shared Web UI action handler
async function runWeb(options: {
  host: string;
  port: string;
  webPort: string;
  db: string;
  token?: string;
  debugDb: string;
  open: boolean;
}): Promise<void> {
  const {
    host,
    port,
    webPort,
    db: dbPath,
    token: providedToken,
    debugDb,
    open: shouldOpen,
  } = options;

  const gatewayUrl = `ws://${host}:${port}`;

  try {
    // Get or create admin token
    const token = providedToken || await getOrCreateAdminToken(dbPath);

    console.log(chalk.blue('Starting Debug Server...'));
    console.log(chalk.gray(`  Gateway: ${gatewayUrl}`));
    console.log(chalk.gray(`  Web UI: http://localhost:${webPort}`));
    console.log(chalk.gray(`  Debug DB: ${debugDb}`));

    // Find debug-server path
    const serverPath = getDebugServerPath();
    const entryPoint = join(serverPath, 'src/index.ts');

    if (!existsSync(entryPoint)) {
      console.error(chalk.red(`Debug Server not found at ${entryPoint}`));
      console.error(chalk.yellow('Make sure you have built the debug-server package.'));
      process.exit(1);
    }

    // Check for Next.js WebUI build
    const webuiPath = join(serverPath, '../webui/.next');
    const webuiServerPath = join(serverPath, '../webui/.next/server');
    const staticHtmlPath = join(serverPath, 'src/static/index.html');
    let staticDir: string | undefined;

    if (existsSync(webuiServerPath)) {
      // Use Next.js server output directory
      staticDir = webuiServerPath;
      console.log(chalk.green('✓ Using Next.js WebUI'));
    } else if (existsSync(webuiPath)) {
      // Fallback to .next directory
      staticDir = webuiPath;
      console.log(chalk.yellow('⚠ Using Next.js build output (not optimized)'));
    } else if (existsSync(staticHtmlPath)) {
      staticDir = join(serverPath, 'src/static');
      console.log(chalk.yellow('⚠ Next.js WebUI not built, using basic HTML interface'));
      console.log(chalk.gray('  Run: cd debug-server/webui && npm install && npm run build'));
    } else {
      console.log(chalk.yellow('⚠ No WebUI found, API-only mode'));
    }

    // Launch debug server as child process
    const args = [
      'tsx',
      entryPoint,
      '--gateway-url', gatewayUrl,
      '--port', String(webPort),
      '--db-path', debugDb,
      '--admin-token', token,
    ];

    if (staticDir) {
      args.push('--static-dir', staticDir);
    }

    const child = spawn('npx', args, {
      stdio: 'inherit',
      cwd: serverPath,
      env: {
        ...process.env,
        ADMIN_TOKEN: token,
      },
    });

    // Open browser after a short delay
    if (shouldOpen) {
      setTimeout(async () => {
        const url = `http://localhost:${webPort}`;
        try {
          const { exec } = await import('child_process');
          const openCmd = process.platform === 'darwin' ? 'open' :
                         process.platform === 'win32' ? 'start' : 'xdg-open';
          exec(`${openCmd} ${url}`);
        } catch {
          console.log(chalk.blue(`Open ${url} in your browser`));
        }
      }, 1500);
    }

    // Handle child process exit
    child.on('exit', (code) => {
      process.exit(code || 0);
    });

    // Forward signals to child
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));

  } catch (error) {
    console.error(chalk.red('Debug Server error:'), error);
    process.exit(1);
  }
}

export const debugCommand = new Command('debug')
  .description('Launch the debug/observability TUI or Web UI');

debugCommand
  .command('start')
  .description('Start Debug Server in background')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-w, --web-port <port>', 'Debug Server HTTP port', String(DEFAULT_DEBUG_SERVER_PORT))
  .option('-d, --db <path>', 'Main database path (for token creation)', DEFAULT_DB_PATH)
  .option('-t, --token <token>', 'Authentication token (auto-created if not provided)')
  .option('--debug-db <path>', 'Debug Server database path', './debug.db')
  .action((options) => {
    const existing = readDebugServerPidInfo();
    if (existing && isProcessRunning(existing.pid)) {
      console.log(chalk.yellow('Debug Server is already running'));
      console.log(chalk.gray(`  PID: ${existing.pid}`));
      console.log(chalk.gray(`  Address: http://127.0.0.1:${existing.webPort}`));
      process.exit(0);
    }

    try {
      const result = startDebugServerProcess({
        host: options.host,
        port: options.port,
        webPort: options.webPort,
        db: options.db,
        token: options.token,
        debugDb: options.debugDb,
      });

      console.log(chalk.green('✓ Debug Server started'));
      console.log(chalk.gray(`  PID: ${result.pid}`));
      console.log(chalk.gray(`  Address: http://127.0.0.1:${options.webPort}`));
      console.log(chalk.gray(`  Logs: ${DEBUG_SERVER_LOG_FILE}`));
    } catch (error) {
      console.log(chalk.red('Failed to start Debug Server'));
      console.log(chalk.gray((error as Error).message));
      process.exit(1);
    }
  });

debugCommand
  .command('stop')
  .description('Stop Debug Server')
  .option('-f, --force', 'Force kill with SIGKILL')
  .action(async (options) => {
    try {
      const result = await stopDebugServerProcess(Boolean(options.force));
      if (result === 'not_running') {
        console.log(chalk.yellow('Debug Server is not running'));
        process.exit(0);
      }

      console.log(chalk.green('✓ Debug Server stopped'));
    } catch (error) {
      console.log(chalk.red('Failed to stop Debug Server'));
      console.log(chalk.gray((error as Error).message));
      process.exit(1);
    }
  });

debugCommand
  .command('restart')
  .description('Restart Debug Server')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-w, --web-port <port>', 'Debug Server HTTP port', String(DEFAULT_DEBUG_SERVER_PORT))
  .option('-d, --db <path>', 'Main database path (for token creation)', DEFAULT_DB_PATH)
  .option('-t, --token <token>', 'Authentication token (auto-created if not provided)')
  .option('--debug-db <path>', 'Debug Server database path', './debug.db')
  .action(async (options) => {
    try {
      await stopDebugServerProcess(false);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = startDebugServerProcess({
        host: options.host,
        port: options.port,
        webPort: options.webPort,
        db: options.db,
        token: options.token,
        debugDb: options.debugDb,
      });

      console.log(chalk.green('✓ Debug Server restarted'));
      console.log(chalk.gray(`  PID: ${result.pid}`));
      console.log(chalk.gray(`  Address: http://127.0.0.1:${options.webPort}`));
      console.log(chalk.gray(`  Logs: ${DEBUG_SERVER_LOG_FILE}`));
    } catch (error) {
      console.log(chalk.red('Failed to restart Debug Server'));
      console.log(chalk.gray((error as Error).message));
      process.exit(1);
    }
  });

debugCommand
  .command('status')
  .description('Show Debug Server status')
  .action(() => {
    const info = readDebugServerPidInfo();
    if (!info || !isProcessRunning(info.pid)) {
      console.log(chalk.yellow('Debug Server is not running'));
      console.log(chalk.gray('Start with: pb debug start'));
      removeDebugServerPidInfo();
      return;
    }

    console.log(chalk.green('✓ Debug Server is running'));
    console.log(chalk.gray(`  PID: ${info.pid}`));
    console.log(chalk.gray(`  Address: http://127.0.0.1:${info.webPort}`));
    console.log(chalk.gray(`  Gateway: ws://${info.host}:${info.gatewayPort}`));
    console.log(chalk.gray(`  Uptime: ${formatUptime(Date.now() - info.startedAt)}`));
    console.log(chalk.gray(`  Logs: ${DEBUG_SERVER_LOG_FILE}`));
  });

debugCommand
  .command('logs')
  .description('Show Debug Server logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <n>', 'Number of lines to show', '50')
  .action((options) => {
    if (!existsSync(DEBUG_SERVER_LOG_FILE)) {
      console.log(chalk.yellow('No debug server log file found'));
      process.exit(0);
    }

    if (options.follow) {
      const tail = spawn('tail', ['-f', DEBUG_SERVER_LOG_FILE], { stdio: 'inherit' });
      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
      return;
    }

    try {
      const output = readFileSync(DEBUG_SERVER_LOG_FILE, 'utf-8')
        .split('\n')
        .slice(-parseInt(options.lines, 10))
        .join('\n');
      console.log(output);
    } catch {
      console.log(chalk.red('Failed to read debug server log file'));
    }
  });

// 'tui' subcommand - Terminal UI (also the default)
debugCommand
  .command('tui', { isDefault: true })
  .description('Launch the terminal-based debug TUI (default)')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .option('-t, --token <token>', 'Authentication token (auto-created if not provided)')
  .action(runTui);

// 'web' subcommand - Web UI
debugCommand
  .command('web')
  .description('Launch the Debug Server with Web UI')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-w, --web-port <port>', 'Debug Server HTTP port', String(DEFAULT_DEBUG_SERVER_PORT))
  .option('-d, --db <path>', 'Main database path (for token creation)', DEFAULT_DB_PATH)
  .option('-t, --token <token>', 'Authentication token (auto-created if not provided)')
  .option('--debug-db <path>', 'Debug Server database path', './debug.db')
  .option('--no-open', 'Do not open browser automatically')
  .action(runWeb);
