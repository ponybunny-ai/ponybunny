/**
 * Scheduler Factory
 *
 * Creates a fully configured SchedulerCore instance with all dependencies.
 */

import type { WorkItem, Escalation, EscalationContext } from '../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ILLMProvider } from '../../infra/llm/llm-provider.js';
import type { SchedulerConfig, SchedulerDependencies } from '../../scheduler/core/types.js';
import type { IExecutionService } from '../../app/lifecycle/stage-interfaces.js';
import type { IWorkItemRepository } from '../../scheduler/work-item-manager/work-item-manager.js';
import type { IEscalationRepository } from '../../scheduler/escalation-handler/escalation-handler.js';
import type { ILLMReviewer } from '../../scheduler/quality-gate-runner/types.js';

import { SchedulerCore } from '../../scheduler/core/index.js';
import { ModelSelector } from '../../scheduler/model-selector/index.js';
import { LaneSelector } from '../../scheduler/lane-selector/index.js';
import { BudgetTracker } from '../../scheduler/budget-tracker/index.js';
import { RetryHandler } from '../../scheduler/retry-handler/index.js';
import { WorkItemManager } from '../../scheduler/work-item-manager/index.js';
import { EscalationHandler } from '../../scheduler/escalation-handler/index.js';
import { QualityGateRunner, DefaultCommandExecutor, MockLLMReviewer } from '../../scheduler/quality-gate-runner/index.js';

import { SchedulerRepositoryAdapter } from './scheduler-repository-adapter.js';
import { ExecutionEngineAdapter } from './execution-engine-adapter.js';

export interface SchedulerFactoryConfig {
  /** Scheduler tick interval in ms (default: 1000) */
  tickIntervalMs?: number;
  /** Maximum concurrent goals (default: 5) */
  maxConcurrentGoals?: number;
  /** Auto-start scheduler on goal submission (default: false) */
  autoStart?: boolean;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

export interface SchedulerFactoryDependencies {
  repository: IWorkOrderRepository;
  executionService: IExecutionService;
  llmProvider?: ILLMProvider;
}

/**
 * Create a fully configured SchedulerCore instance
 */
export function createScheduler(
  deps: SchedulerFactoryDependencies,
  config?: SchedulerFactoryConfig
): SchedulerCore {
  const { repository, executionService, llmProvider } = deps;

  // Create adapters
  const repositoryAdapter = new SchedulerRepositoryAdapter(repository);
  const executionEngineAdapter = new ExecutionEngineAdapter(executionService);

  // Create model selector (uses default config and scorer)
  const modelSelector = new ModelSelector();

  // Create lane selector
  const laneSelector = new LaneSelector();

  // Create budget tracker
  const budgetTracker = new BudgetTracker();

  // Create retry handler
  const retryHandler = new RetryHandler();

  // Create work item manager with repository adapter
  const workItemRepository: IWorkItemRepository = {
    getWorkItem: (id: string) => repository.getWorkItem(id),
    getWorkItemsByGoal: (goalId: string) => repository.getWorkItemsByGoal(goalId),
    updateWorkItemStatus: (id: string, status: WorkItem['status']) =>
      repository.updateWorkItemStatus(id, status),
    updateWorkItemStatusIfDependenciesMet: (id: string) =>
      repository.updateWorkItemStatusIfDependenciesMet(id),
  };
  const workItemManager = new WorkItemManager(workItemRepository);

  // Create escalation handler with repository adapter
  const escalationRepository: IEscalationRepository = {
    createEscalation: (params) =>
      repository.createEscalation({
        work_item_id: params.work_item_id,
        goal_id: params.goal_id,
        run_id: params.run_id,
        escalation_type: params.escalation_type,
        severity: params.severity,
        title: params.title,
        description: params.description,
      }),
    getEscalation: (_id: string) => undefined, // TODO: Add to repository interface
    updateEscalationStatus: (_id: string, _status) => {
      // TODO: Add to repository interface
    },
    resolveEscalation: (_id: string, _params) => {
      // TODO: Add to repository interface
    },
    getOpenEscalations: (_goalId?: string) => [] as Escalation[],
    getEscalationsByGoal: (_goalId: string) => [] as Escalation[],
    getEscalationsByWorkItem: (_workItemId: string) => [] as Escalation[],
  };
  const escalationHandler = new EscalationHandler(escalationRepository);

  // Create quality gate runner
  const commandExecutor = new DefaultCommandExecutor();
  const llmReviewer: ILLMReviewer = llmProvider
    ? createLLMReviewerAdapter(llmProvider)
    : new MockLLMReviewer();
  const qualityGateRunner = new QualityGateRunner(commandExecutor, llmReviewer);

  // Assemble dependencies
  const schedulerDeps: SchedulerDependencies = {
    repository: repositoryAdapter,
    modelSelector: {
      selectModel: (workItem, _goal) => modelSelector.selectModel(workItem),
    },
    laneSelector: {
      selectLane: (workItem, goal) => laneSelector.selectLane(workItem, goal),
      hasCapacity: (laneId) => laneSelector.hasCapacity(laneId),
      incrementActive: (laneId) => laneSelector.incrementActive(laneId),
      decrementActive: (laneId) => laneSelector.decrementActive(laneId),
    },
    budgetTracker: {
      getBudgetStatus: (goal) => budgetTracker.getBudgetStatus(goal),
      willExceedBudget: (goal, tokens, cost) => budgetTracker.willExceedBudget(goal, tokens, cost),
      recordUsage: (goalId, tokens, timeMinutes, costUsd) =>
        budgetTracker.recordUsage(goalId, tokens, timeMinutes, costUsd),
    },
    retryHandler: {
      decideRetry: (workItem, error, context) => retryHandler.decideRetry(workItem, error, context),
    },
    escalationHandler: {
      hasBlockingEscalations: (goalId) => escalationHandler.hasBlockingEscalations(goalId),
      createEscalation: (params) =>
        escalationHandler.createEscalation({
          workItemId: params.workItemId,
          goalId: params.goalId,
          type: params.type as Escalation['escalation_type'],
          severity: params.severity as Escalation['severity'],
          title: params.title,
          description: params.description,
          context: params.description ? ({ description: params.description } as EscalationContext) : undefined,
        }),
    },
    qualityGateRunner: {
      runVerification: (workItem, run) => qualityGateRunner.runVerification(workItem, run),
    },
    workItemManager: {
      getNextWorkItem: (goalId) => workItemManager.getNextWorkItem(goalId),
      getReadyWorkItems: (goalId) => workItemManager.getReadyWorkItems(goalId),
      areAllWorkItemsComplete: (goalId) => workItemManager.areAllWorkItemsComplete(goalId),
      updateStatus: (workItemId, status) => workItemManager.updateStatus(workItemId, status),
      areDependenciesSatisfied: (workItem) => workItemManager.areDependenciesSatisfied(workItem),
    },
    executionEngine: executionEngineAdapter,
  };

  // Create scheduler config
  const schedulerConfig: Partial<SchedulerConfig> = {
    tickIntervalMs: config?.tickIntervalMs ?? 1000,
    maxConcurrentGoals: config?.maxConcurrentGoals ?? 5,
    autoStart: config?.autoStart ?? false,
    debug: config?.debug ?? false,
  };

  return new SchedulerCore(schedulerDeps, schedulerConfig);
}

/**
 * Create an LLM reviewer adapter from an ILLMProvider
 */
function createLLMReviewerAdapter(llmProvider: ILLMProvider): ILLMReviewer {
  return {
    async review(
      prompt: string,
      context?: Record<string, unknown>
    ): Promise<{ passed: boolean; reasoning: string }> {
      const contextStr = context ? `\nContext: ${JSON.stringify(context)}` : '';
      const response = await llmProvider.complete([
        {
          role: 'system',
          content: `You are a code reviewer. Review based on the given prompt.
Respond with JSON: { "passed": boolean, "reasoning": "string" }`,
        },
        {
          role: 'user',
          content: `${prompt}${contextStr}`,
        },
      ]);

      try {
        const result = JSON.parse(response.content || '{}');
        return {
          passed: Boolean(result.passed),
          reasoning: String(result.reasoning || result.feedback || ''),
        };
      } catch {
        return {
          passed: false,
          reasoning: 'Failed to parse LLM response',
        };
      }
    },
  };
}
