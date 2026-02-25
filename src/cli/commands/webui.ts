import { Command } from 'commander';
import chalk from 'chalk';

export const webuiCommand = new Command('webui')
  .description('Manage Web UI service');

webuiCommand
  .command('start')
  .description('Start Web UI service')
  .action(() => {
    console.log(chalk.blue('Starting Web UI...'));
    console.log(chalk.yellow('Web UI dev server not yet implemented'));
    console.log(chalk.gray('Run manually: cd web && npm run dev'));
  });

webuiCommand
  .command('stop')
  .description('Stop Web UI service')
  .action(() => {
    console.log(chalk.gray('Web UI stop is not managed by CLI yet'));
    console.log(chalk.gray('Stop manually in the shell running the dev server'));
  });

webuiCommand
  .command('restart')
  .description('Restart Web UI service')
  .action(() => {
    console.log(chalk.gray('Web UI restart is not managed by CLI yet'));
    console.log(chalk.gray('Restart manually: stop current process, then run `pb webui start`'));
  });

webuiCommand
  .command('status')
  .description('Show Web UI service status')
  .action(() => {
    console.log(chalk.gray('Web UI status is not managed by CLI yet'));
    console.log(chalk.gray('Use your dev server output to confirm status'));
  });
