#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { authCommand } from './commands/auth.js';
import { chatCommand } from './commands/chat.js';
import { goalCommand } from './commands/goal.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('pb')
  .description('PonyBunny - Autonomous AI Employee CLI')
  .version('1.0.0');

program
  .command('auth')
  .description('Authentication commands')
  .addCommand(authCommand);

program
  .command('chat')
  .description('Interactive chat with AI assistant')
  .option('-m, --model <model>', 'Model to use (default: gpt-5.2)', 'gpt-5.2')
  .option('-s, --system <message>', 'System message')
  .action(chatCommand);

program
  .command('goal')
  .description('Create and manage autonomous goals')
  .addCommand(goalCommand);

program
  .command('status')
  .description('Check system and authentication status')
  .action(statusCommand);

program
  .command('config')
  .description('Manage CLI configuration')
  .addCommand(configCommand);

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(chalk.yellow('Run `pb --help` for available commands'));
  process.exit(1);
});

program.parse();
