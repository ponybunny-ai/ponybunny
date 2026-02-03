import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { modelsManager } from '../lib/models-manager.js';

export const modelsCommand = new Command('models');

modelsCommand
  .description('Manage model lists')
  .addHelpText('after', `
Examples:
  $ pb models list         List cached models
  $ pb models refresh      Refresh models from APIs
  $ pb models clear        Clear cache and reset to defaults
  $ pb models info         Show cache information
`);

modelsCommand
  .command('list')
  .description('List all available models from cache')
  .action(async () => {
    try {
      const cache = await modelsManager.getModels();
      
      console.log(chalk.cyan('\n📋 OpenAI Codex Models:'));
      cache.models.codex.forEach((model, idx) => {
        console.log(chalk.white(`  ${idx + 1}. ${model.label || model.name}`));
      });
      
      console.log(chalk.magenta('\n📋 Antigravity Models:'));
      cache.models.antigravity.forEach((model, idx) => {
        console.log(chalk.white(`  ${idx + 1}. ${model.label || model.name}`));
      });
      
      const age = modelsManager.getCacheAge();
      if (age) {
        const hours = Math.floor(age / (1000 * 60 * 60));
        console.log(chalk.gray(`\nCache age: ${hours} hours ago`));
      }
      console.log();
    } catch (error) {
      console.error(chalk.red(`Failed to list models: ${(error as Error).message}`));
      process.exit(1);
    }
  });

modelsCommand
  .command('refresh')
  .description('Refresh model lists from APIs')
  .action(async () => {
    const spinner = ora('Fetching models from APIs...').start();
    
    try {
      const cache = await modelsManager.refreshModels();
      spinner.succeed('Models refreshed successfully');
      
      console.log(chalk.green(`\n✓ Cached ${cache.models.codex.length} Codex models`));
      console.log(chalk.green(`✓ Cached ${cache.models.antigravity.length} Antigravity models\n`));
    } catch (error) {
      spinner.fail('Failed to refresh models');
      console.error(chalk.red(`Error: ${(error as Error).message}`));
      process.exit(1);
    }
  });

modelsCommand
  .command('clear')
  .description('Clear cache and reset to defaults')
  .action(() => {
    try {
      modelsManager.clearCache();
      console.log(chalk.green('\n✓ Models cache cleared and reset to defaults\n'));
    } catch (error) {
      console.error(chalk.red(`Failed to clear cache: ${(error as Error).message}`));
      process.exit(1);
    }
  });

modelsCommand
  .command('info')
  .description('Show cache information')
  .action(async () => {
    try {
      const cache = await modelsManager.getModels();
      const age = modelsManager.getCacheAge();
      
      console.log(chalk.cyan('\n📊 Models Cache Info:'));
      console.log(chalk.white(`  Version: ${cache.version}`));
      console.log(chalk.white(`  Last Updated: ${new Date(cache.lastUpdated).toLocaleString()}`));
      
      if (age) {
        const hours = Math.floor(age / (1000 * 60 * 60));
        const minutes = Math.floor((age % (1000 * 60 * 60)) / (1000 * 60));
        console.log(chalk.white(`  Age: ${hours}h ${minutes}m`));
        
        const ttl = 24 * 60 * 60 * 1000;
        const remaining = ttl - age;
        if (remaining > 0) {
          const remainingHours = Math.floor(remaining / (1000 * 60 * 60));
          console.log(chalk.green(`  Valid for: ${remainingHours} more hours`));
        } else {
          console.log(chalk.yellow(`  Status: Expired (run 'pb models refresh')`));
        }
      }
      
      console.log(chalk.white(`  Codex Models: ${cache.models.codex.length}`));
      console.log(chalk.white(`  Antigravity Models: ${cache.models.antigravity.length}\n`));
    } catch (error) {
      console.error(chalk.red(`Failed to get cache info: ${(error as Error).message}`));
      process.exit(1);
    }
  });
