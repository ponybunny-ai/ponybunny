/**
 * Debug Server Entry Point
 *
 * Starts the debug server process that connects to Gateway,
 * collects debug events, and serves the Web UI.
 */

import { DebugServer } from './debug-server.js';
import type { DebugServerOptions } from './debug-server.js';

// Parse command line arguments
function parseArgs(): Partial<DebugServerOptions> {
  const args = process.argv.slice(2);
  const config: Partial<DebugServerOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--gateway-url':
      case '-g':
        config.gatewayUrl = nextArg;
        i++;
        break;
      case '--port':
      case '-p':
        config.port = parseInt(nextArg, 10);
        i++;
        break;
      case '--db-path':
      case '-d':
        config.dbPath = nextArg;
        i++;
        break;
      case '--static-dir':
      case '-s':
        config.staticDir = nextArg;
        i++;
        break;
      case '--admin-token':
      case '-t':
        config.adminToken = nextArg;
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
Debug Server - Real-time debugging interface for PonyBunny

Usage: npx tsx src/index.ts [options]

Options:
  -g, --gateway-url <url>   Gateway WebSocket URL (default: ws://localhost:18789)
  -p, --port <port>         HTTP/WebSocket port (default: 18790)
  -d, --db-path <path>      SQLite database path (default: ~/.ponybunny/debug.db)
  -s, --static-dir <path>   Static files directory (default: ./src/static)
  -t, --admin-token <token> Admin token for Gateway authentication
  -h, --help                Show this help message

Environment Variables:
  GATEWAY_URL               Gateway WebSocket URL
  DEBUG_SERVER_PORT         HTTP/WebSocket port
  DEBUG_DB_PATH             SQLite database path
  ADMIN_TOKEN               Admin token for Gateway authentication

Examples:
  npx tsx src/index.ts
  npx tsx src/index.ts --port 18790 --gateway-url ws://localhost:18789
  ADMIN_TOKEN=xxx npx tsx src/index.ts
`);
}

// Build configuration from environment and args
function buildConfig(): DebugServerOptions {
  const args = parseArgs();

  return {
    gatewayUrl: args.gatewayUrl || process.env.GATEWAY_URL || 'ws://localhost:18789',
    port: args.port || parseInt(process.env.DEBUG_SERVER_PORT || '18790', 10),
    dbPath: args.dbPath || process.env.DEBUG_DB_PATH,
    staticDir: args.staticDir || process.env.STATIC_DIR || './src/static',
    adminToken: args.adminToken || process.env.ADMIN_TOKEN,
  };
}

// Main entry point
async function main(): Promise<void> {
  const config = buildConfig();

  console.log('Starting Debug Server...');
  console.log(`  Gateway URL: ${config.gatewayUrl}`);
  console.log(`  HTTP Port: ${config.port}`);
  console.log(`  Database: ${config.dbPath || '~/.ponybunny/debug.db'}`);
  console.log(`  Static Dir: ${config.staticDir}`);

  const server = new DebugServer(config);

  // Handle graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await server.start();
    console.log(`\nDebug Server running at http://localhost:${config.port}`);
    console.log('Press Ctrl+C to stop\n');
  } catch (error) {
    console.error('Failed to start Debug Server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

// Export for programmatic use
export { DebugServer } from './debug-server.js';
export type { DebugServerOptions } from './debug-server.js';
