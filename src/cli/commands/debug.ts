/**
 * Debug CLI Command - Launch the debug/observability TUI or Web UI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { startDebugTui } from '../debug-tui/index.js';

const DEFAULT_HOST = process.env.PONY_GATEWAY_HOST || '127.0.0.1';
const DEFAULT_PORT = parseInt(process.env.PONY_GATEWAY_PORT || '18789', 10);
const DEFAULT_DB_PATH = process.env.PONY_DB_PATH || './pony.db';
const DEFAULT_DEBUG_SERVER_PORT = parseInt(process.env.DEBUG_SERVER_PORT || '3001', 10);

const PONY_DIR = join(homedir(), '.ponybunny');
const DEBUG_CONFIG_FILE = join(PONY_DIR, 'debug-config.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface DebugConfig {
  adminToken?: string;
  tokenId?: string;
  createdAt?: number;
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
  try {
    const schemaPath = join(__dirname, '../../infra/persistence/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  } catch {
    try {
      const distSchemaPath = join(__dirname, '../../../dist/infra/persistence/schema.sql');
      const schema = readFileSync(distSchemaPath, 'utf-8');
      db.exec(schema);
    } catch {
      // Schema might already exist
    }
  }

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
