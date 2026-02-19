import { Command } from 'commander';
import chalk from 'chalk';
import { accountManagerV2, authManagerV2 } from '../lib/auth-manager-v2.js';

async function showConfig(): Promise<void> {
  const config = authManagerV2.getConfig();
  const isAuth = accountManagerV2.isAuthenticated('codex');
  
  console.log(chalk.cyan('\nCurrent Configuration:\n'));
  console.log(chalk.white('  Authenticated:'), isAuth ? chalk.green('Yes') : chalk.red('No'));
  
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
