import type { AgentRegistry } from '../infra/agents/agent-registry.js';
import {
  getGlobalRunnerRegistry,
  type RunnerRegistry,
} from '../infra/agents/runner-registry.js';
import { createSchemaDrivenAgentRunner } from '../infra/agents/schema-driven-agent-runner.js';
import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IScheduler } from '../scheduler/types.js';
import { AgentScheduler, startAgentSchedulerLoop } from './agent-scheduler.js';

export interface DaemonRecurringStartupDependencies {
  repository: IWorkOrderRepository;
  scheduler: IScheduler;
  registry: AgentRegistry;
  schedulerTickIntervalMs: number;
  agentsEnabled?: boolean;
  runnerRegistry?: RunnerRegistry;
  instanceId?: string;
  logger?: Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
}

export interface DaemonRecurringStartupResult {
  agentScheduler: AgentScheduler | null;
  agentSchedulerInterval: NodeJS.Timeout | null;
}

export function startDaemonRecurringStartup(
  deps: DaemonRecurringStartupDependencies
): DaemonRecurringStartupResult {
  const logger = deps.logger ?? console;
  const runnerRegistry = deps.runnerRegistry ?? getGlobalRunnerRegistry();
  const schemaRunner = createSchemaDrivenAgentRunner();

  runnerRegistry.registerMany([
    { type: 'default', runner: schemaRunner },
    { type: 'market_listener', runner: schemaRunner },
  ]);
  logger.log('[SchedulerDaemon] Registered default schema-driven runner');

  if (!deps.agentsEnabled) {
    return {
      agentScheduler: null,
      agentSchedulerInterval: null,
    };
  }

  const agentScheduler = new AgentScheduler(
    {
      repository: deps.repository,
      scheduler: deps.scheduler,
      registry: deps.registry,
      logger,
    },
    {
      claimTtlMs: deps.schedulerTickIntervalMs * 2,
      instanceId: deps.instanceId ?? `scheduler-daemon-${process.pid}`,
    }
  );
  const agentSchedulerInterval = startAgentSchedulerLoop(
    agentScheduler,
    deps.schedulerTickIntervalMs,
    {
      onDispatchError: (error) => {
        logger.error('[SchedulerDaemon] AgentScheduler dispatch failed:', error);
      },
    }
  );

  logger.log('[SchedulerDaemon] AgentScheduler loop enabled');

  return {
    agentScheduler,
    agentSchedulerInterval,
  };
}
