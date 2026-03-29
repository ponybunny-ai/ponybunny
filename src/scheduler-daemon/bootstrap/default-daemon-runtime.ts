import type Database from 'better-sqlite3';

import type { IExecutionService } from '../../app/lifecycle/stage-interfaces.js';
import { getGlobalAgentRegistry } from '../../infra/agents/agent-registry.js';
import type { ILLMProvider } from '../../infra/llm/llm-provider.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import { getGlobalRunnerRegistry } from '../../infra/agents/runner-registry.js';
import { getLLMService } from '../../infra/llm/index.js';
import {
  LocalExecutionAdapter,
  RegistryBackedLocalExecutionAgentTickResolver,
} from '../../runtime/execution-boundary/index.js';
import { LocalExecutionWorker } from '../../runtime/workers/index.js';
import type { RuntimeToolingContext } from '../../runtime/tooling-context/index.js';
import { createDefaultScheduler } from '../../scheduler/composition/index.js';
import type { SchedulerCore } from '../../scheduler/core/index.js';
import type { SchedulerSessionEvent } from '../session-intake.js';
import { SchedulerSessionIntake } from '../session-intake.js';
import { ElaborationService } from '../../app/lifecycle/elaboration/elaboration-service.js';
import { PlanningService } from '../../app/lifecycle/planning/planning-service.js';
import { GlobalKnowledgeService } from '../../domain/knowledge/index.js';
import { GoalHarness } from '../../harness/goal-harness.js';
import type { IGoalHarness } from '../../harness/goal-harness-interface.js';
import { PostGoalEvaluator } from '../../harness/post-goal-evaluator.js';
import { EvaluationService } from '../../app/lifecycle/evaluation/evaluation-service.js';
import { JsonLogger } from '../../infra/observability/logger.js';

export interface DefaultSchedulerDaemonRuntimeConfig {
  tickIntervalMs?: number;
  maxConcurrentGoals?: number;
  debug?: boolean;
  executionMode?: 'direct' | 'evented';
  deterministicRuntimeEnabled?: boolean;
  planCompilerEnabled?: boolean;
  toolRoutingMode?: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout?: {
    shadowModeEnabled: boolean;
    canaryPercent: number;
    rollbackOnFailure: boolean;
    lanePercents: {
      dryRun: number;
      compile: number;
      replay: number;
    };
  };
}

export interface DefaultSchedulerDaemonRuntimeDependencies {
  repository: IWorkOrderRepository;
  executionService: IExecutionService;
  llmProvider: ILLMProvider;
  config: DefaultSchedulerDaemonRuntimeConfig;
}

export interface SchedulerDaemonRuntimeAssembly {
  scheduler: SchedulerCore;
  executionWorker: LocalExecutionWorker;
}

export interface SchedulerDaemonSessionIntakeDependencies {
  repository: IWorkOrderRepository;
  memoryDb: Database.Database;
  runtimeToolingContext: RuntimeToolingContext;
  schedulerProvider: () => SchedulerCore | null;
  publishSessionEvent: (event: SchedulerSessionEvent) => Promise<void>;
}

export function createDefaultSchedulerDaemonRuntime(
  deps: DefaultSchedulerDaemonRuntimeDependencies
): SchedulerDaemonRuntimeAssembly {
  const agentTickResolver = new RegistryBackedLocalExecutionAgentTickResolver(
    getGlobalAgentRegistry(),
    getGlobalRunnerRegistry()
  );
  const executionPort = new LocalExecutionAdapter(deps.executionService, agentTickResolver);
  const executionWorker = new LocalExecutionWorker(executionPort);
  const scheduler = createDefaultScheduler(
    {
      repository: deps.repository,
      executionService: deps.executionService,
      llmProvider: deps.llmProvider,
      executionPort,
    },
    {
      tickIntervalMs: deps.config.tickIntervalMs ?? 1000,
      maxConcurrentGoals: deps.config.maxConcurrentGoals ?? 5,
      autoStart: false,
      debug: deps.config.debug ?? false,
      executionMode: deps.config.executionMode ?? 'direct',
      deterministicRuntimeEnabled: deps.config.deterministicRuntimeEnabled ?? false,
      planCompilerEnabled: deps.config.planCompilerEnabled ?? false,
      toolRoutingMode: deps.config.toolRoutingMode ?? 'legacy',
      runtimeRollout: deps.config.runtimeRollout ?? {
        shadowModeEnabled: false,
        canaryPercent: 0,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 0,
          compile: 0,
          replay: 0,
        },
      },
    }
  );

  return {
    scheduler,
    executionWorker,
  };
}

export function createSchedulerDaemonSessionIntake(
  deps: SchedulerDaemonSessionIntakeDependencies
): SchedulerSessionIntake {
  return new SchedulerSessionIntake({
    repository: deps.repository,
    memoryDb: deps.memoryDb,
    llmService: getLLMService(),
    runtimeToolingContext: deps.runtimeToolingContext,
    schedulerProvider: deps.schedulerProvider,
    publishSessionEvent: deps.publishSessionEvent,
  });
}

/**
 * ADR-001: Assemble GoalHarness with all dependencies.
 *
 * Returns undefined if GlobalKnowledgeService cannot be initialized
 * (e.g., missing table), preserving rollback safety.
 */
export interface GoalHarnessAssemblyDependencies {
  repository: IWorkOrderRepository;
  llmProvider: ILLMProvider;
  scheduler: SchedulerCore;
  runtimeToolingContext?: RuntimeToolingContext;
  /** Explicit database handle for GlobalKnowledgeService. If not provided, GoalHarness is not created. */
  knowledgeDb?: Database.Database;
}

export function assembleGoalHarness(
  deps: GoalHarnessAssemblyDependencies
): IGoalHarness | undefined {
  let globalKnowledge: GlobalKnowledgeService | undefined;
  if (deps.knowledgeDb) {
    try {
      globalKnowledge = new GlobalKnowledgeService(deps.knowledgeDb);
      console.log('[GoalHarness Assembly] Global Knowledge Service initialized');
    } catch {
      console.warn('[GoalHarness Assembly] Global Knowledge Service unavailable — GoalHarness will proceed without it');
    }
  }

  const elaborationService = new ElaborationService(deps.repository, globalKnowledge);
  const planningService = new PlanningService(
    deps.repository,
    deps.llmProvider,
    undefined,
    deps.runtimeToolingContext,
    globalKnowledge
  );

  const logger = new JsonLogger({ level: 'info' });

  const harness = new GoalHarness({
    repository: deps.repository,
    elaborationService,
    planningService,
    schedulerCore: deps.scheduler,
    logger: logger.child({ component: 'GoalHarness' }),
  });

  console.log('[GoalHarness Assembly] GoalHarness assembled successfully');
  return harness;
}

/**
 * ADR-001 Phase 5: Assemble PostGoalEvaluator for post-goal evaluation hooks.
 *
 * Subscribes to SchedulerCore goal_completed/goal_failed events and evaluates
 * work item outcomes via EvaluationService.
 */
export interface PostGoalEvaluatorAssemblyDependencies {
  repository: IWorkOrderRepository;
  scheduler: SchedulerCore;
  /** Database handle for GlobalKnowledgeService. If provided, enables automatic knowledge extraction. */
  knowledgeDb?: Database.Database;
  /** Optional logger — defaults to JsonLogger if not provided. */
  logger?: import('../../infra/observability/logger.js').ILogger;
}

export function assemblePostGoalEvaluator(
  deps: PostGoalEvaluatorAssemblyDependencies
): PostGoalEvaluator {
  const evaluationService = new EvaluationService(deps.repository);

  let globalKnowledgeService: GlobalKnowledgeService | undefined;
  if (deps.knowledgeDb) {
    try {
      globalKnowledgeService = new GlobalKnowledgeService(deps.knowledgeDb);
      console.log('[PostGoalEvaluator Assembly] Global Knowledge Service wired for flywheel');
    } catch {
      console.warn('[PostGoalEvaluator Assembly] Global Knowledge Service unavailable — knowledge extraction disabled');
    }
  }

  const evalLogger = deps.logger ?? new JsonLogger({ level: 'info' });
  const evaluator = new PostGoalEvaluator({
    schedulerCore: deps.scheduler,
    evaluationService,
    repository: deps.repository,
    globalKnowledgeService,
    db: deps.knowledgeDb,
    logger: evalLogger.child({ component: 'PostGoalEvaluator' }),
  });

  console.log('[PostGoalEvaluator Assembly] PostGoalEvaluator assembled successfully');
  return evaluator;
}
