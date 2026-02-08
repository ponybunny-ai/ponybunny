#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { authCommand } from './commands/auth.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';
import { modelsCommand } from './commands/models.js';
import { gatewayCommand } from './commands/gateway.js';
import { schedulerCommand } from './commands/scheduler-daemon.js';
import { debugCommand } from './commands/debug.js';
import { initCommand } from './commands/init.js';
import { serviceCommand } from './commands/service.js';
import { registerWorkCommand } from './commands/work.js';
import { startTui } from './tui/start.js';

const program = new Command();

program
  .name('pb')
  .description('PonyBunny - Autonomous AI Employee CLI')
  .version('1.0.0')
  .option('-u, --url <url>', 'Gateway URL', 'ws://127.0.0.1:18789')
  .option('-t, --token <token>', 'Authentication token')
  .action(async (options) => {
    await startTui({ url: options.url, token: options.token });
  });

program.addCommand(authCommand);
program.addCommand(configCommand);
program.addCommand(modelsCommand);
program.addCommand(gatewayCommand);
program.addCommand(schedulerCommand);
program.addCommand(debugCommand);
program.addCommand(initCommand);
program.addCommand(serviceCommand);
registerWorkCommand(program);

program
  .command('status')
  .description('Check system and authentication status')
  .action(statusCommand);

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(chalk.yellow('Run `pb --help` for available commands'));
  process.exit(1);
});

program.parse();
