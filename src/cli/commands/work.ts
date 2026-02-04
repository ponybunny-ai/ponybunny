import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { getLLMService, LLMRouter, MockLLMProvider } from '../../infra/llm/index.js';

export function registerWorkCommand(program: Command) {
  program
    .command('work')
    .description('Assign a task to the autonomous agent')
    .argument('<task>', 'The task description')
    .option('--db <path>', 'Path to SQLite database', './pony-work-orders.db')
    .action(async (task, options) => {
      console.log(chalk.bold.cyan('\n🐴 PonyBunny Autonomous Agent\n'));

      const spinner = ora('Initializing system...').start();

      // 1. Initialize Database
      const dbPath = process.env.PONY_DB_PATH || options.db;
      const repository = new WorkOrderDatabase(dbPath);

      try {
        await repository.initialize();
      } catch (error) {
        spinner.fail(`Failed to initialize database: ${error}`);
        process.exit(1);
      }

      // 2. Initialize LLM Service
      const llmService = getLLMService();
      const availableProviders = llmService.getAvailableProviders();

      let llmRouter: LLMRouter;

      if (availableProviders.length === 0) {
        spinner.warn(chalk.yellow('No API keys found. Using Mock Provider (results will be simulated).'));
        llmRouter = new LLMRouter([new MockLLMProvider('cli-mock')]);
      } else {
        llmRouter = llmService.createRouter();
        spinner.info(chalk.dim(`Using providers: ${availableProviders.join(', ')}`));
      }

      // 3. Initialize Services
      const executionService = new ExecutionService(
        repository,
        { maxConsecutiveErrors: 3 },
        llmRouter
      );

      spinner.succeed('System ready');

      // 4. Create Goal & Work Item
      console.log(chalk.blue(`\n📝 Task: ${task}`));

      const goal = repository.createGoal({
        title: 'CLI Task',
        description: task,
        priority: 50,
        success_criteria: [{
          description: 'Task executed successfully',
          type: 'heuristic',
          verification_method: 'manual',
          required: true
        }],
      });

      const workItem = repository.createWorkItem({
        goal_id: goal.id,
        title: 'Execute CLI Task',
        description: task,
        item_type: 'code', // Defaulting to code for now
        priority: 50,
      });

      repository.updateWorkItemStatus(workItem.id, 'ready');

      // 5. Execute
      console.log(chalk.dim('\nStarting ReAct cycle...'));
      const executionSpinner = ora('Thinking & Acting...').start();

      try {
        const result = await executionService.executeWorkItem(workItem);

        if (result.success) {
          executionSpinner.succeed(chalk.green('Task completed successfully!'));
        } else {
          executionSpinner.fail(chalk.red('Task failed.'));
        }

        console.log(chalk.bold('\n📊 Execution Summary:'));
        console.log(`  Success: ${result.success ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`  Tokens:  ${result.run.tokens_used}`);
        console.log(`  Cost:    $${result.run.cost_usd.toFixed(4)}`);
        console.log(`  Time:    ${result.run.time_seconds}s`);

        if (result.run.execution_log) {
          console.log(chalk.bold('\n📜 Execution Log:'));
          console.log(chalk.gray('─'.repeat(80)));
          console.log(result.run.execution_log);
          console.log(chalk.gray('─'.repeat(80)));
        }

      } catch (error) {
        executionSpinner.fail(`Critical error: ${error}`);
      } finally {
        repository.close();
      }
    });
}
