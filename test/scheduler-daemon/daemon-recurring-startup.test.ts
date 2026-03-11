import { jest } from '@jest/globals';

import type { AgentRegistry } from '../../src/infra/agents/agent-registry.js';
import { RunnerRegistry } from '../../src/infra/agents/runner-registry.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import { AgentScheduler } from '../../src/scheduler-daemon/agent-scheduler.js';
import { startDaemonRecurringStartup } from '../../src/scheduler-daemon/daemon-recurring-startup.js';
import type { IScheduler } from '../../src/scheduler/types.js';

const createLogger = () => ({
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('startDaemonRecurringStartup', () => {
  it('registers the schema-driven runners even when recurring agents are disabled', () => {
    const runnerRegistry = new RunnerRegistry();
    const logger = createLogger();

    const result = startDaemonRecurringStartup({
      repository: {} as IWorkOrderRepository,
      scheduler: {} as IScheduler,
      registry: {} as AgentRegistry,
      runnerRegistry,
      schedulerTickIntervalMs: 1000,
      agentsEnabled: false,
      logger,
    });

    expect(runnerRegistry.hasRunner('default')).toBe(true);
    expect(runnerRegistry.hasRunner('market_listener')).toBe(true);
    expect(result).toEqual({
      agentScheduler: null,
      agentSchedulerInterval: null,
    });
    expect(logger.log).toHaveBeenCalledWith('[SchedulerDaemon] Registered default schema-driven runner');
    expect(logger.log).not.toHaveBeenCalledWith('[SchedulerDaemon] AgentScheduler loop enabled');
  });

  it('enables the recurring loop after registering the touched runners', () => {
    const runnerRegistry = new RunnerRegistry();
    const logger = createLogger();
    const result = startDaemonRecurringStartup({
      repository: {} as IWorkOrderRepository,
      scheduler: {} as IScheduler,
      registry: {} as AgentRegistry,
      runnerRegistry,
      schedulerTickIntervalMs: 1000,
      agentsEnabled: true,
      instanceId: 'test-daemon',
      logger,
    });

    try {
      expect(runnerRegistry.hasRunner('default')).toBe(true);
      expect(runnerRegistry.hasRunner('market_listener')).toBe(true);
      expect(result.agentScheduler).toBeInstanceOf(AgentScheduler);
      expect(result.agentSchedulerInterval).not.toBeNull();
      expect(logger.log.mock.calls).toEqual([
        ['[SchedulerDaemon] Registered default schema-driven runner'],
        ['[SchedulerDaemon] AgentScheduler loop enabled'],
      ]);
    } finally {
      if (result.agentSchedulerInterval) {
        clearInterval(result.agentSchedulerInterval);
      }
    }
  });
});
