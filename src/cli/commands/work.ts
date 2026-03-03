import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { getLLMService, MockLLMProvider } from '../../infra/llm/index.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { buildWorkItemRunResultDTO } from '../../domain/work-order/result-dto.js';

function buildWorkModelCandidates(fallbackChain: string[]): string[] {
  const candidates = fallbackChain.flatMap((modelId) => {
    if (modelId === 'gpt-5.2') {
      return ['gpt-5.2-codex', modelId];
    }
    return [modelId];
  });

  return Array.from(new Set(candidates));
}

export function registerWorkCommand(program: Command) {
  const runtimeConfig = loadRuntimeConfig();

  program
    .command('work')
    .description('Assign a task to the autonomous agent')
    .argument('<task>', 'The task description')
    .option('--db <path>', 'Path to SQLite database', runtimeConfig.paths.database)
    .option('--model <model>', 'Specific LLM model to use')
    .action(async (task, options) => {
      console.log(chalk.bold.cyan('\n🐴 PonyBunny Autonomous Agent\n'));

      const spinner = ora('Initializing system...').start();

      // 1. Initialize Database
      const dbPath = options.db || runtimeConfig.paths.database;
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

      let llmProvider;

      if (availableProviders.length === 0) {
        spinner.warn(chalk.yellow('No API keys found. Using Mock Provider (results will be simulated).'));
        llmProvider = new MockLLMProvider('cli-mock');
      } else {
        llmProvider = llmService;
        spinner.info(chalk.dim(`Available providers: ${availableProviders.join(', ')}`));
      }

      // 3. Initialize Services
      const executionService = new ExecutionService(
        repository,
        { maxConsecutiveErrors: 3 },
        llmProvider
      );

      spinner.succeed('System ready');

      // 4. Create Goal & Work Item
      console.log(chalk.blue(`\n📝 Task: ${task}`));

  const defaultModel = llmService.getModelForWorkload('execution');
  const fallbackChain = llmService.getFallbackChainForWorkload('execution');
      const modelCandidates = buildWorkModelCandidates([defaultModel, ...fallbackChain]);

      const model = options.model || modelCandidates.find((candidateModel) => {
        return llmService.getAvailableEndpointsForModel(candidateModel).length > 0;
      }) || defaultModel;

      spinner.info(chalk.dim(`Selected model: ${model}`));

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
        item_type: 'code',
        priority: 50,
        context: { model },
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
        const resultDto = buildWorkItemRunResultDTO({
          runId: result.run.id,
          workItemId: result.run.work_item_id,
          goalId: result.run.goal_id,
          status: result.run.status,
          createdAt: result.run.created_at,
          completedAt: result.run.completed_at,
          tokensUsed: result.run.tokens_used,
          timeSeconds: result.run.time_seconds,
          costUsd: result.run.cost_usd,
          executionLog: result.run.execution_log,
          errorMessage: result.run.error_message,
          artifactIds: result.run.artifacts,
          workItemStatus: workItem.status,
          verificationStatus: workItem.status === 'done' ? 'passed' : 'not_started',
        });

        console.log(`  Success: ${result.success ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`  Tokens:  ${resultDto.usage.tokensUsed}`);
        console.log(`  Cost:    $${resultDto.usage.costUsd.toFixed(4)}`);
        console.log(`  Time:    ${resultDto.usage.timeSeconds}s`);
        console.log(`  Result:  ${resultDto.output.summary}`);
        console.log(`  Artifacts: ${resultDto.artifacts.count}`);

        if (resultDto.output.executionLog) {
          console.log(chalk.bold('\n📜 Execution Log:'));
          console.log(chalk.gray('─'.repeat(80)));
          console.log(resultDto.output.executionLog);
          console.log(chalk.gray('─'.repeat(80)));
        }

      } catch (error) {
        executionSpinner.fail(`Critical error: ${error}`);
      } finally {
        repository.close();
      }
    });
}
