/**
 * Debug CLI Command - Launch the debug/observability TUI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import { startDebugTui } from '../debug-tui/index.js';

const DEFAULT_HOST = process.env.PONY_GATEWAY_HOST || '127.0.0.1';
const DEFAULT_PORT = parseInt(process.env.PONY_GATEWAY_PORT || '18789', 10);
const DEFAULT_DB_PATH = process.env.PONY_DB_PATH || './pony.db';

const PONY_DIR = join(homedir(), '.ponybunny');
const DEBUG_CONFIG_FILE = join(PONY_DIR, 'debug-config.json');

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
      const row = db.prepare('SELECT * FROM pairing_tokens WHERE id = ? AND revoked_at IS NULL').get(config.tokenId) as any;
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
  const { readFileSync: readSchema } = await import('fs');
  const { join: joinPath, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));

  try {
    const schemaPath = joinPath(__dirname, '../../infra/persistence/schema.sql');
    const schema = readSchema(schemaPath, 'utf-8');
    db.exec(schema);
  } catch {
    try {
      const distSchemaPath = joinPath(__dirname, '../../../dist/infra/persistence/schema.sql');
      const schema = readSchema(distSchemaPath, 'utf-8');
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

export const debugCommand = new Command('debug')
  .description('Launch the debug/observability TUI')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-d, --db <path>', 'Database path', DEFAULT_DB_PATH)
  .option('-t, --token <token>', 'Authentication token (auto-created if not provided)')
  .action(async (options) => {
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
  });
