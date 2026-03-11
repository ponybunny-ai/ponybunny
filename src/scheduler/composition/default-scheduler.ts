import type { WorkItem, Escalation, EscalationContext } from '../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ILLMProvider } from '../../infra/llm/llm-provider.js';
import type { SchedulerConfig, SchedulerDependencies } from '../core/types.js';
import type { IExecutionService } from '../../app/lifecycle/stage-interfaces.js';
import { getGlobalAgentRegistry } from '../../infra/agents/agent-registry.js';
import type { IWorkItemRepository } from '../work-item-manager/work-item-manager.js';
import type { IEscalationRepository } from '../escalation-handler/escalation-handler.js';
import { getGlobalRunnerRegistry } from '../../infra/agents/runner-registry.js';
import type { ILLMReviewer } from '../quality-gate-runner/types.js';
import type {
  ExecutionPort,
  LocalExecutionAgentTickResolver,
} from '../../runtime/execution-boundary/index.js';
import type { EventBus as RuntimeEventBus } from '../../runtime/event-bus/index.js';

import { SchedulerCore } from '../core/index.js';
import { ModelSelector } from '../model-selector/index.js';
import { LaneSelector } from '../lane-selector/index.js';
import { BudgetTracker } from '../budget-tracker/index.js';
import { RetryHandler } from '../retry-handler/index.js';
import { WorkItemManager } from '../work-item-manager/index.js';
import { EscalationHandler } from '../escalation-handler/index.js';
import { QualityGateRunner, DefaultCommandExecutor, MockLLMReviewer } from '../quality-gate-runner/index.js';
import {
  LocalExecutionAdapter,
  RegistryBackedLocalExecutionAgentTickResolver,
} from '../../runtime/execution-boundary/index.js';
import { runtimeEventBus } from '../../runtime/event-bus/index.js';

import { SchedulerRepositoryAdapter } from './scheduler-repository-adapter.js';

export interface DefaultSchedulerConfig {
  tickIntervalMs?: number;
  maxConcurrentGoals?: number;
  autoStart?: boolean;
  debug?: boolean;
  executionMode?: 'direct' | 'evented';
  deterministicRuntimeEnabled?: boolean;
  planCompilerEnabled?: boolean;
  toolRoutingMode?: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout?: SchedulerConfig['runtimeRollout'];
}

export interface DefaultSchedulerDependencies {
  repository: IWorkOrderRepository;
  executionService: IExecutionService;
  llmProvider?: ILLMProvider;
  executionPort?: ExecutionPort;
  agentTickResolver?: LocalExecutionAgentTickResolver;
  runtimeEventBus?: RuntimeEventBus;
}

export function createDefaultScheduler(
  deps: DefaultSchedulerDependencies,
  config?: DefaultSchedulerConfig
): SchedulerCore {
  const { repository, executionService, llmProvider } = deps;

  const repositoryAdapter = new SchedulerRepositoryAdapter(repository);
  const agentTickResolver =
    deps.agentTickResolver
    ?? new RegistryBackedLocalExecutionAgentTickResolver(
      getGlobalAgentRegistry(),
      getGlobalRunnerRegistry()
    );
  const executionPort =
    deps.executionPort ?? new LocalExecutionAdapter(executionService, agentTickResolver);
  const bus = deps.runtimeEventBus ?? runtimeEventBus;

  const modelSelector = new ModelSelector();
  const laneSelector = new LaneSelector();
  const budgetTracker = new BudgetTracker();
  const retryHandler = new RetryHandler();

  // Preserve scheduler-authoritative work-item transitions and durable repository ownership.
  const workItemRepository: IWorkItemRepository = {
    getWorkItem: (id: string) => repository.getWorkItem(id),
    getWorkItemsByGoal: (goalId: string) => repository.getWorkItemsByGoal(goalId),
    updateWorkItemStatus: (id: string, status: WorkItem['status']) =>
      repository.updateWorkItemStatus(id, status),
    updateWorkItemStatusIfDependenciesMet: (id: string) =>
      repository.updateWorkItemStatusIfDependenciesMet(id),
  };
  const workItemManager = new WorkItemManager(workItemRepository);

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
    getEscalation: (_id: string) => undefined,
    updateEscalationStatus: (_id: string, _status) => {},
    resolveEscalation: (_id: string, _params) => {},
    getOpenEscalations: (_goalId?: string) => [] as Escalation[],
    getEscalationsByGoal: (_goalId: string) => [] as Escalation[],
    getEscalationsByWorkItem: (_workItemId: string) => [] as Escalation[],
  };
  const escalationHandler = new EscalationHandler(escalationRepository);

  const commandExecutor = new DefaultCommandExecutor();
  const llmReviewer: ILLMReviewer = llmProvider
    ? createLLMReviewerAdapter(llmProvider)
    : new MockLLMReviewer();
  const qualityGateRunner = new QualityGateRunner(commandExecutor, llmReviewer);

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
          context: params.description
            ? ({ description: params.description } as EscalationContext)
            : undefined,
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
    executionPort,
    runtimeEventBus: bus,
  };

  const schedulerConfig: Partial<SchedulerConfig> = {
    tickIntervalMs: config?.tickIntervalMs ?? 1000,
    maxConcurrentGoals: config?.maxConcurrentGoals ?? 5,
    autoStart: config?.autoStart ?? false,
    debug: config?.debug ?? false,
    executionMode: config?.executionMode ?? 'direct',
    deterministicRuntimeEnabled: config?.deterministicRuntimeEnabled ?? false,
    planCompilerEnabled: config?.planCompilerEnabled ?? false,
    toolRoutingMode: config?.toolRoutingMode ?? 'legacy',
    runtimeRollout: config?.runtimeRollout,
  };

  return new SchedulerCore(schedulerDeps, schedulerConfig);
}

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
