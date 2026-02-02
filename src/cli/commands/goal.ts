import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { gatewayClient } from '../lib/gateway-client.js';

async function createGoal(): Promise<void> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'title',
      message: 'Goal title:',
      validate: (input) => input.trim().length > 0 || 'Title is required',
    },
    {
      type: 'editor',
      name: 'description',
      message: 'Goal description:',
      validate: (input) => input.trim().length > 0 || 'Description is required',
    },
    {
      type: 'number',
      name: 'budget_tokens',
      message: 'Token budget (optional):',
      default: 100000,
    },
  ]);

  const spinner = ora('Creating goal...').start();

  try {
    const goal = await gatewayClient.createGoal({
      title: answers.title,
      description: answers.description,
      budget_tokens: answers.budget_tokens,
    });

    spinner.succeed('Goal created successfully!');
    console.log(chalk.cyan(`\nGoal ID: ${goal.id}`));
    console.log(chalk.white(`Title: ${goal.title}`));
    console.log(chalk.white(`Status: ${goal.status}`));
  } catch (error) {
    spinner.fail('Failed to create goal');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

async function listGoals(): Promise<void> {
  const spinner = ora('Fetching goals...').start();

  try {
    const goals = await gatewayClient.listGoals();
    spinner.succeed(`Found ${goals.length} goal(s)`);

    if (goals.length === 0) {
      console.log(chalk.yellow('\nNo goals found. Create one with `pb goal create`'));
      return;
    }

    console.log();
    goals.forEach((goal) => {
      console.log(chalk.cyan(`\n━━━ ${goal.title} ━━━`));
      console.log(chalk.white(`  ID: ${goal.id}`));
      console.log(chalk.white(`  Status: ${goal.status}`));
      console.log(chalk.gray(`  Created: ${new Date(goal.created_at).toLocaleString()}`));
    });
  } catch (error) {
    spinner.fail('Failed to fetch goals');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

async function showGoal(id: string): Promise<void> {
  const spinner = ora('Fetching goal...').start();

  try {
    const goal = await gatewayClient.getGoal(id);
    spinner.succeed('Goal details');

    console.log(chalk.cyan(`\n━━━ ${goal.title} ━━━`));
    console.log(chalk.white(`  ID: ${goal.id}`));
    console.log(chalk.white(`  Status: ${goal.status}`));
    console.log(chalk.white(`  Description: ${goal.description}`));
    console.log(chalk.gray(`  Created: ${new Date(goal.created_at).toLocaleString()}`));
    console.log(chalk.gray(`  Updated: ${new Date(goal.updated_at).toLocaleString()}`));
  } catch (error) {
    spinner.fail('Failed to fetch goal');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

export const goalCommand = new Command('goal')
  .description('Manage autonomous goals');

goalCommand
  .command('create')
  .description('Create a new goal')
  .action(createGoal);

goalCommand
  .command('list')
  .description('List all goals')
  .action(listGoals);

goalCommand
  .command('show <id>')
  .description('Show goal details')
  .action(showGoal);
