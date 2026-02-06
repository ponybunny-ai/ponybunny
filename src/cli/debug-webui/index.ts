/**
 * Debug Web UI - Entry point for the browser-based debug interface
 */

export { DebugWebServer, type DebugWebServerOptions } from './server.js';

import open from 'open';
import chalk from 'chalk';
import { DebugWebServer } from './server.js';

export interface StartDebugWebUIOptions {
  webPort?: number;
  gatewayUrl?: string;
  token: string;
  openBrowser?: boolean;
}

/**
 * Start the debug web UI server and optionally open browser
 */
export async function startDebugWebUI(options: StartDebugWebUIOptions): Promise<void> {
  const webPort = options.webPort || 18790;
  const gatewayUrl = options.gatewayUrl || 'ws://127.0.0.1:18789';

  const server = new DebugWebServer({
    webPort,
    gatewayUrl,
    token: options.token,
  });

  // Handle shutdown
  const shutdown = () => {
    console.log(chalk.gray('\nShutting down...'));
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await server.start();

    const url = `http://127.0.0.1:${webPort}`;
    console.log(chalk.green(`✓ Debug Web UI running at ${chalk.cyan(url)}`));
    console.log(chalk.gray('  Press Ctrl+C to stop'));

    if (options.openBrowser !== false) {
      await open(url);
    }

    // Keep process running
    await new Promise(() => {});
  } catch (error) {
    console.error(chalk.red('Failed to start Debug Web UI:'), error);
    process.exit(1);
  }
}
