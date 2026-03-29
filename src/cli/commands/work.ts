import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline/promises';
import { WorkOrderDatabase } from '../../work-order/database/manager.js';
import { ExecutionService } from '../../app/lifecycle/execution/execution-service.js';
import { PlanningService } from '../../app/lifecycle/planning/planning-service.js';
import { getLLMService, MockLLMProvider } from '../../infra/llm/index.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { buildWorkItemRunResultDTO } from '../../domain/work-order/result-dto.js';
import Database from 'better-sqlite3';
import { GlobalKnowledgeService } from '../../domain/knowledge/index.js';
import type { WorkItem } from '../../work-order/types/index.js';

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
    .option('--plan-first', 'Show execution plan and wait for approval before executing')
    .option('--review-plan', 'Submit via daemon with plan review — pause after planning for approval')
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

      // 4. Select model
      console.log(chalk.blue(`\nTask: ${task}`));

      const defaultModel = llmService.getModelForWorkload('execution');
      const fallbackChain = llmService.getFallbackChainForWorkload('execution');
      const modelCandidates = buildWorkModelCandidates([defaultModel, ...fallbackChain]);

      const model = options.model || modelCandidates.find((candidateModel) => {
        return llmService.getAvailableEndpointsForModel(candidateModel).length > 0;
      }) || defaultModel;

      spinner.info(chalk.dim(`Selected model: ${model}`));

      // 5. Create Goal
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

      // --review-plan: submit via daemon/RPC with plan review pause
      if (options.reviewPlan) {
        const { GatewayClient } = await import('../gateway/gateway-client.js');
        const client = new GatewayClient();

        try {
          client.start();
          // Wait for connection (up to 5 seconds)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
            client.onConnected = () => { clearTimeout(timeout); resolve(); };
            client.onError = (err) => { clearTimeout(timeout); reject(err); };
          });
        } catch {
          spinner.fail('Cannot connect to gateway. Start the daemon first: pb gateway start');
          client.stop();
          repository.close();
          process.exit(1);
        }

        spinner.text = 'Submitting goal with plan review...';

        const goalResult = await client.request<{ id: string; status: string }>('goal.submit', {
          title: 'CLI Task',
          description: task,
          success_criteria: [{
            description: 'Task executed successfully',
            type: 'heuristic',
            verification_method: 'manual',
            required: true,
          }],
          context: { review_plan: true, selected_model: model },
        });

        spinner.succeed(`Goal submitted: ${goalResult.id}`);

        // Poll for plan_review status
        const pollSpinner = ora('Waiting for plan generation...').start();
        let planReady = false;
        for (let i = 0; i < 120; i++) { // 2 min max
          const status = await client.request<{ status: string }>('goal.status', { goalId: goalResult.id });
          if (status.status === 'plan_review') {
            planReady = true;
            break;
          }
          if (status.status === 'active' || status.status === 'completed' || status.status === 'cancelled' || status.status === 'blocked') {
            pollSpinner.info(`Goal moved to ${status.status} — plan review was not triggered`);
            client.stop();
            repository.close();
            process.exit(0);
          }
          await new Promise(r => setTimeout(r, 1000));
        }

        if (!planReady) {
          pollSpinner.fail('Timed out waiting for plan generation');
          client.stop();
          repository.close();
          process.exit(1);
        }

        // Fetch and display the plan
        const planData = await client.request<{
          goalId: string;
          status: string;
          workItems: WorkItem[];
        }>('plan.get', { goalId: goalResult.id });

        pollSpinner.succeed(`Plan ready: ${planData.workItems.length} work item(s)`);
        displayPlan(planData.workItems, new Map());

        // Ask for user approval
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(chalk.bold('\nApprove and execute this plan? [y/N] '));
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          await client.request('plan.reject', { goalId: goalResult.id, reason: 'Rejected by user via CLI' });
          console.log(chalk.yellow('\nPlan rejected. Goal cancelled.'));
          client.stop();
          repository.close();
          process.exit(0);
        }

        await client.request('plan.approve', { goalId: goalResult.id });
        console.log(chalk.green('\nPlan approved. Goal delegated to scheduler for execution.'));
        console.log(chalk.dim(`  Goal ID: ${goalResult.id}`));
        console.log(chalk.dim('  Monitor progress: pb events tail'));

        client.stop();
        repository.close();
        return;
      }

      // --plan-first: use PlanningService to generate work items, display plan, and ask for approval
      if (options.planFirst) {
        const planSpinner = ora('Generating execution plan...').start();

        // Wire up global knowledge for pitfall injection during planning
        let globalKnowledge: GlobalKnowledgeService | undefined;
        try {
          const knowledgeDb = new Database(dbPath, { readonly: true });
          globalKnowledge = new GlobalKnowledgeService(knowledgeDb);
        } catch {
          // global_knowledge table may not exist yet — graceful degradation
        }

        const planningService = new PlanningService(repository, llmProvider, undefined, undefined, globalKnowledge);
        let planResult;
        try {
          planResult = await planningService.planWorkItems(goal);
        } catch (error) {
          planSpinner.fail(`Planning failed: ${error}`);
          repository.close();
          process.exit(1);
        }

        if (planResult.workItems.length === 0) {
          planSpinner.warn('Planning produced no work items');
          repository.close();
          process.exit(0);
        }

        planSpinner.succeed(`Plan generated: ${planResult.workItems.length} work item(s)`);

        // Display the plan
        displayPlan(planResult.workItems, planResult.dependencies);

        // Ask for user approval
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(chalk.bold('\nApprove and execute this plan? [y/N] '));
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
          console.log(chalk.yellow('\nPlan not approved. Goal preserved for later review.'));
          console.log(chalk.gray(`  Goal ID: ${goal.id}`));
          repository.close();
          process.exit(0);
        }

        console.log(chalk.blue('\nExecuting approved plan...\n'));

        // Execute each ready work item sequentially
        try {
          for (const workItem of planResult.workItems) {
            const itemSpinner = ora(`Executing: ${workItem.title}`).start();

            // Ensure item is ready
            if (workItem.status !== 'ready') {
              repository.updateWorkItemStatus(workItem.id, 'ready');
            }

            const result = await executionService.executeWorkItem(workItem);

            if (result.success) {
              itemSpinner.succeed(chalk.green(`Done: ${workItem.title}`));
            } else {
              itemSpinner.fail(chalk.red(`Failed: ${workItem.title}`));
              console.log(chalk.gray(`  Error: ${result.run.error_message || 'unknown'}`));
              // Continue with remaining items — the scheduler pattern allows partial completion
            }
          }
          console.log(chalk.green('\nPlan execution complete.'));
        } catch (error) {
          console.error(chalk.red(`\nCritical error during execution: ${error}`));
        } finally {
          repository.close();
        }
        return;
      }

      // Direct execution (no --plan-first): create a single work item and execute
      const workItem = repository.createWorkItem({
        goal_id: goal.id,
        title: 'Execute CLI Task',
        description: task,
        item_type: 'code',
        priority: 50,
        context: { model },
      });

      repository.updateWorkItemStatus(workItem.id, 'ready');

      console.log(chalk.dim('\nStarting ReAct cycle...'));
      const executionSpinner = ora('Thinking & Acting...').start();

      try {
        const result = await executionService.executeWorkItem(workItem);

        if (result.success) {
          executionSpinner.succeed(chalk.green('Task completed successfully!'));
        } else {
          executionSpinner.fail(chalk.red('Task failed.'));
        }

        console.log(chalk.bold('\nExecution Summary:'));
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
          console.log(chalk.bold('\nExecution Log:'));
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

function displayPlan(workItems: WorkItem[], dependencies: Map<string, string[]>): void {
  console.log(chalk.bold('\nExecution Plan'));
  console.log(chalk.gray('─'.repeat(60)));

  for (let i = 0; i < workItems.length; i++) {
    const item = workItems[i];
    const deps = dependencies.get(item.id);

    console.log(chalk.white(`\n  ${i + 1}. ${item.title}`));
    console.log(chalk.gray(`     Type: ${item.item_type}  |  Priority: ${item.priority}  |  Effort: ${item.estimated_effort}`));
    console.log(chalk.gray(`     ${item.description}`));

    if (deps && deps.length > 0) {
      const depNames = deps.map(depId => {
        const dep = workItems.find(w => w.id === depId);
        return dep ? dep.title : depId.slice(0, 8);
      });
      console.log(chalk.yellow(`     Depends on: ${depNames.join(', ')}`));
    }

    const vp = item.verification_plan;
    if (vp) {
      if (vp.quality_gates && vp.quality_gates.length > 0) {
        console.log(chalk.cyan(`     Quality gates:`));
        for (const gate of vp.quality_gates) {
          const req = gate.required ? chalk.red('[required]') : chalk.gray('[optional]');
          const cmd = gate.command ? chalk.gray(` → ${gate.command}`) : '';
          console.log(chalk.cyan(`       - ${gate.name} (${gate.type}) ${req}${cmd}`));
        }
      }
      if (vp.acceptance_criteria && vp.acceptance_criteria.length > 0) {
        console.log(chalk.cyan(`     Acceptance criteria:`));
        for (const criterion of vp.acceptance_criteria) {
          console.log(chalk.cyan(`       - ${criterion}`));
        }
      }
    }
  }

  console.log(chalk.gray('\n' + '─'.repeat(60)));
  console.log(chalk.dim(`  Total: ${workItems.length} work item(s)`));
}
