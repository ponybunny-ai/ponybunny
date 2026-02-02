import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../lib/auth-manager.js';

async function showConfig(): Promise<void> {
  const config = authManager.getConfig();
  
  console.log(chalk.cyan('\nCurrent Configuration:\n'));
  console.log(chalk.white('  Authenticated:'), config.accessToken ? chalk.green('Yes') : chalk.red('No'));
  
  if (config.email) {
    console.log(chalk.white('  Email:'), config.email);
  }
  
  if (config.userId) {
    console.log(chalk.white('  User ID:'), config.userId);
  }
  
  console.log();
}

export const configCommand = new Command('config')
  .description('Manage CLI configuration');

configCommand
  .command('show')
  .description('Show current configuration')
  .action(showConfig);
