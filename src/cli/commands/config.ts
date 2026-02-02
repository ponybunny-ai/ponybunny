import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { authManager } from '../lib/auth-manager.js';

async function setGateway(): Promise<void> {
  const { url } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Gateway URL:',
      default: 'https://api.ponybunny.ai',
      validate: (input) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Invalid URL';
        }
      },
    },
  ]);

  authManager.saveConfig({ gatewayUrl: url });
  console.log(chalk.green(`✓ Gateway URL set to: ${url}`));
}

async function showConfig(): Promise<void> {
  const config = authManager.getConfig();
  
  console.log(chalk.cyan('\nCurrent Configuration:\n'));
  console.log(chalk.white('  Gateway URL:'), config.gatewayUrl || 'https://api.ponybunny.ai (default)');
  console.log(chalk.white('  Authenticated:'), config.accessToken ? chalk.green('Yes') : chalk.red('No'));
  
  if (config.email) {
    console.log(chalk.white('  Email:'), config.email);
  }
  
  console.log();
}

export const configCommand = new Command('config')
  .description('Manage CLI configuration');

configCommand
  .command('set-gateway')
  .description('Set gateway URL')
  .action(setGateway);

configCommand
  .command('show')
  .description('Show current configuration')
  .action(showConfig);
