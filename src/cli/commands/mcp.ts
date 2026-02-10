/**
 * MCP CLI Commands
 * Commands for managing MCP server connections
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  setMCPServerConfig,
  removeMCPServerConfig,
  listMCPServers,
  getMCPServerConfig,
  mcpConfigFileExists,
  saveMCPConfig,
  getMCPConfigPath,
} from '../../infra/mcp/index.js';
import type { MCPServerConfig } from '../../infra/mcp/index.js';
import { getMCPConnectionManager } from '../../infra/mcp/index.js';

export function createMCPCommand(): Command {
  const mcp = new Command('mcp')
    .description('Manage MCP (Model Context Protocol) server connections');

  // pb mcp list
  mcp
    .command('list')
    .description('List all configured MCP servers')
    .action(async () => {
      try {
        if (!mcpConfigFileExists()) {
          console.log(chalk.yellow('No MCP configuration file found.'));
          console.log(chalk.gray(`Expected location: ${getMCPConfigPath()}`));
          return;
        }

        const servers = listMCPServers();
        if (servers.length === 0) {
          console.log(chalk.yellow('No MCP servers configured.'));
          return;
        }

        console.log(chalk.bold('\nConfigured MCP Servers:\n'));

        for (const serverName of servers) {
          const config = getMCPServerConfig(serverName);
          if (!config) continue;

          const enabled = config.enabled !== false;
          const status = enabled ? chalk.green('✓ enabled') : chalk.gray('✗ disabled');

          console.log(chalk.bold(`${serverName}`) + ` ${status}`);
          console.log(chalk.gray(`  Transport: ${config.transport}`));

          if (config.transport === 'stdio') {
            console.log(chalk.gray(`  Command: ${config.command} ${config.args?.join(' ') || ''}`));
          } else if (config.transport === 'http') {
            console.log(chalk.gray(`  URL: ${config.url}`));
          }

          if (config.allowedTools && config.allowedTools.length > 0) {
            const toolsDisplay = config.allowedTools.includes('*')
              ? 'all tools'
              : config.allowedTools.join(', ');
            console.log(chalk.gray(`  Allowed tools: ${toolsDisplay}`));
          }

          console.log();
        }
      } catch (error) {
        console.error(chalk.red('Error listing MCP servers:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp status
  mcp
    .command('status')
    .description('Show connection status of MCP servers')
    .action(async () => {
      try {
        const connectionManager = getMCPConnectionManager();
        const statuses = connectionManager.getAllConnectionStatus();

        if (statuses.length === 0) {
          console.log(chalk.yellow('No MCP servers connected.'));
          return;
        }

        console.log(chalk.bold('\nMCP Server Status:\n'));

        for (const status of statuses) {
          const stateColor =
            status.state === 'connected'
              ? chalk.green
              : status.state === 'failed'
              ? chalk.red
              : chalk.yellow;

          console.log(chalk.bold(`${status.serverName}`) + ` ${stateColor(status.state)}`);

          if (status.serverInfo) {
            console.log(chalk.gray(`  Version: ${status.serverInfo.version}`));
            console.log(chalk.gray(`  Protocol: ${status.serverInfo.protocolVersion}`));
          }

          if (status.lastConnected) {
            console.log(chalk.gray(`  Last connected: ${status.lastConnected.toLocaleString()}`));
          }

          if (status.lastError) {
            console.log(chalk.red(`  Error: ${status.lastError}`));
          }

          console.log();
        }
      } catch (error) {
        console.error(chalk.red('Error getting MCP status:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp add
  mcp
    .command('add <name>')
    .description('Add a new MCP server configuration')
    .option('-t, --transport <type>', 'Transport type (stdio or http)', 'stdio')
    .option('-c, --command <command>', 'Command to execute (stdio transport)')
    .option('-a, --args <args...>', 'Command arguments (stdio transport)')
    .option('-u, --url <url>', 'Server URL (http transport)')
    .option('--enabled', 'Enable the server', true)
    .option('--disabled', 'Disable the server')
    .action(async (name: string, options: any) => {
      try {
        const transport = options.transport as 'stdio' | 'http';

        const config: MCPServerConfig = {
          enabled: options.disabled ? false : options.enabled,
          transport,
        };

        if (transport === 'stdio') {
          if (!options.command) {
            console.error(chalk.red('Error: --command is required for stdio transport'));
            process.exit(1);
          }
          config.command = options.command;
          config.args = options.args || [];
        } else if (transport === 'http') {
          if (!options.url) {
            console.error(chalk.red('Error: --url is required for http transport'));
            process.exit(1);
          }
          config.url = options.url;
        }

        setMCPServerConfig(name, config);
        console.log(chalk.green(`✓ Added MCP server: ${name}`));
        console.log(chalk.gray(`Configuration saved to: ${getMCPConfigPath()}`));
      } catch (error) {
        console.error(chalk.red('Error adding MCP server:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp remove
  mcp
    .command('remove <name>')
    .description('Remove an MCP server configuration')
    .action(async (name: string) => {
      try {
        const removed = removeMCPServerConfig(name);
        if (removed) {
          console.log(chalk.green(`✓ Removed MCP server: ${name}`));
        } else {
          console.log(chalk.yellow(`MCP server not found: ${name}`));
        }
      } catch (error) {
        console.error(chalk.red('Error removing MCP server:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp enable
  mcp
    .command('enable <name>')
    .description('Enable an MCP server')
    .action(async (name: string) => {
      try {
        const config = getMCPServerConfig(name);
        if (!config) {
          console.error(chalk.red(`MCP server not found: ${name}`));
          process.exit(1);
        }

        config.enabled = true;
        setMCPServerConfig(name, config);
        console.log(chalk.green(`✓ Enabled MCP server: ${name}`));
      } catch (error) {
        console.error(chalk.red('Error enabling MCP server:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp disable
  mcp
    .command('disable <name>')
    .description('Disable an MCP server')
    .action(async (name: string) => {
      try {
        const config = getMCPServerConfig(name);
        if (!config) {
          console.error(chalk.red(`MCP server not found: ${name}`));
          process.exit(1);
        }

        config.enabled = false;
        setMCPServerConfig(name, config);
        console.log(chalk.green(`✓ Disabled MCP server: ${name}`));
      } catch (error) {
        console.error(chalk.red('Error disabling MCP server:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp test
  mcp
    .command('test <name>')
    .description('Test connection to an MCP server')
    .action(async (name: string) => {
      try {
        const config = getMCPServerConfig(name);
        if (!config) {
          console.error(chalk.red(`MCP server not found: ${name}`));
          process.exit(1);
        }

        console.log(chalk.blue(`Testing connection to ${name}...`));

        const { MCPClient } = await import('../../infra/mcp/index.js');
        const client = new MCPClient({
          serverName: name,
          config,
        });

        await client.connect();
        console.log(chalk.green('✓ Connection successful'));

        const serverInfo = client.getServerInfo();
        if (serverInfo) {
          console.log(chalk.gray(`  Server: ${serverInfo.name} v${serverInfo.version}`));
          console.log(chalk.gray(`  Protocol: ${serverInfo.protocolVersion}`));
        }

        // List tools
        const tools = await client.listTools();
        console.log(chalk.gray(`  Tools available: ${tools.length}`));

        await client.disconnect();
      } catch (error) {
        console.error(chalk.red('✗ Connection failed:'), (error as Error).message);
        process.exit(1);
      }
    });

  // pb mcp init
  mcp
    .command('init')
    .description('Initialize MCP configuration file with examples')
    .action(async () => {
      try {
        if (mcpConfigFileExists()) {
          console.log(chalk.yellow('MCP configuration file already exists.'));
          console.log(chalk.gray(`Location: ${getMCPConfigPath()}`));
          return;
        }

        const exampleConfig = {
          mcpServers: {
            filesystem: {
              enabled: false,
              transport: 'stdio' as const,
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
              allowedTools: ['read_file', 'write_file', 'list_directory'],
              autoReconnect: true,
              timeout: 30000,
            },
          },
        };

        saveMCPConfig(exampleConfig);
        console.log(chalk.green('✓ Created MCP configuration file'));
        console.log(chalk.gray(`Location: ${getMCPConfigPath()}`));
        console.log(chalk.gray('\nExample server added (disabled). Edit the file to configure your servers.'));
      } catch (error) {
        console.error(chalk.red('Error initializing MCP config:'), (error as Error).message);
        process.exit(1);
      }
    });

  return mcp;
}
