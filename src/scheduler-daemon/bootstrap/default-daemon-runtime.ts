import type Database from 'better-sqlite3';

import type { IExecutionService } from '../../app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../../infra/llm/llm-provider.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import { getLLMService } from '../../infra/llm/index.js';
import { LocalExecutionAdapter } from '../../runtime/execution-boundary/index.js';
import { LocalExecutionWorker } from '../../runtime/workers/index.js';
import type { RuntimeToolingContext } from '../../runtime/tooling-context/index.js';
import { createDefaultScheduler } from '../../scheduler/composition/index.js';
import type { SchedulerCore } from '../../scheduler/core/index.js';
import type { SchedulerSessionEvent } from '../session-intake.js';
import { SchedulerSessionIntake } from '../session-intake.js';

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
  const executionPort = new LocalExecutionAdapter(deps.executionService);
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
