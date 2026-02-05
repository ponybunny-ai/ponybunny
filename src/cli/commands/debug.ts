/**
 * Debug CLI Command - Launch the debug/observability TUI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { startDebugTui } from '../debug-tui/index.js';

const DEFAULT_HOST = process.env.PONY_GATEWAY_HOST || '127.0.0.1';
const DEFAULT_PORT = parseInt(process.env.PONY_GATEWAY_PORT || '18789', 10);

export const debugCommand = new Command('debug')
  .description('Launch the debug/observability TUI')
  .option('-h, --host <host>', 'Gateway host', DEFAULT_HOST)
  .option('-p, --port <port>', 'Gateway port', String(DEFAULT_PORT))
  .option('-t, --token <token>', 'Authentication token (admin required)')
  .action(async (options) => {
    const { host, port, token } = options;
    const url = `ws://${host}:${port}`;

    console.log(chalk.blue(`Connecting to Gateway at ${url}...`));

    try {
      await startDebugTui({ url, token });
    } catch (error) {
      console.error(chalk.red('Debug TUI error:'), error);
      process.exit(1);
    }
  });
