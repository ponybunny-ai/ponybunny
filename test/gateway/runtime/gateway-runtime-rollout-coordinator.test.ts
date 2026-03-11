import { EventBus } from '../../../src/gateway/events/event-bus.js';
import {
  GatewayRuntimeRolloutCoordinator,
  type GatewayRuntimeRolloutConfigStore,
  type GatewayRuntimeRolloutSchedulerTransport,
} from '../../../src/gateway/runtime/gateway-runtime-rollout-coordinator.js';
import {
  DEFAULT_RUNTIME_CONFIG,
  type PonyBunnyRuntimeConfig,
} from '../../../src/infra/config/runtime-config.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';

function cloneRuntimeConfig(): PonyBunnyRuntimeConfig {
  return JSON.parse(JSON.stringify(DEFAULT_RUNTIME_CONFIG)) as PonyBunnyRuntimeConfig;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('GatewayRuntimeRolloutCoordinator', () => {
  let eventBus: EventBus;
  let repository: jest.Mocked<Pick<IWorkOrderRepository, 'listGoals'>>;
  let configStore: GatewayRuntimeRolloutConfigStore;
  let schedulerTransport: jest.Mocked<GatewayRuntimeRolloutSchedulerTransport>;
  let currentRuntime: PonyBunnyRuntimeConfig;

  beforeEach(() => {
    eventBus = new EventBus();
    currentRuntime = cloneRuntimeConfig();
    currentRuntime.scheduler.deterministicRuntimeEnabled = true;
    currentRuntime.scheduler.planCompilerEnabled = true;
    currentRuntime.scheduler.toolRoutingMode = 'system_preferred';
    currentRuntime.scheduler.runtimeRollout.shadowModeEnabled = true;
    currentRuntime.scheduler.runtimeRollout.canaryPercent = 25;
    currentRuntime.scheduler.runtimeRollout.lanePercents = {
      dryRun: 10,
      compile: 20,
      replay: 30,
    };

    repository = {
      listGoals: jest.fn(() => []),
    };

    configStore = {
      load: jest.fn(() => currentRuntime),
      save: jest.fn((runtime) => {
        currentRuntime = runtime;
      }),
    };

    schedulerTransport = {
      isConnected: jest.fn(() => true),
      applyRuntimeRollout: jest.fn(async (_rollout) => undefined),
    };
  });

  it('rolls runtime rollout back to legacy on failed dry runs', async () => {
    const coordinator = new GatewayRuntimeRolloutCoordinator({
      eventBus,
      repository: repository as unknown as IWorkOrderRepository,
      configStore,
      schedulerTransport,
    });

    coordinator.handleDryRunComplete({
      ok: false,
      planStepCount: 4,
      changedStepCount: 2,
      compileErrorCodes: ['ERR_PLAN'],
      timestamp: 1700000000000,
    });
    await flushAsyncWork();

    expect(coordinator.getMetricsSnapshot()).toEqual(
      expect.objectContaining({
        dryRunsTotal: 1,
        dryRunsFailed: 1,
      })
    );
    expect(configStore.save).toHaveBeenCalledTimes(1);
    expect(currentRuntime.scheduler.deterministicRuntimeEnabled).toBe(false);
    expect(currentRuntime.scheduler.planCompilerEnabled).toBe(false);
    expect(currentRuntime.scheduler.toolRoutingMode).toBe('legacy');
    expect(currentRuntime.scheduler.runtimeRollout).toEqual({
      shadowModeEnabled: false,
      canaryPercent: 0,
      rollbackOnFailure: true,
      lanePercents: {
        dryRun: 0,
        compile: 0,
        replay: 0,
      },
    });
    expect(schedulerTransport.applyRuntimeRollout).toHaveBeenCalledWith({
      deterministicRuntimeEnabled: false,
      planCompilerEnabled: false,
      toolRoutingMode: 'legacy',
      runtimeRollout: {
        shadowModeEnabled: false,
        canaryPercent: 0,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 0,
          compile: 0,
          replay: 0,
        },
      },
    });

    coordinator.dispose();
  });

  it('evaluates event-driven threshold telemetry and triggers rollback when conversation health regresses', async () => {
    repository.listGoals.mockReturnValue([
      { id: 'goal-1', context: {} },
      { id: 'goal-2', context: {} },
      { id: 'goal-3', context: {} },
      { id: 'goal-4', context: {} },
      { id: 'goal-5', context: {} },
    ] as never[]);

    const coordinator = new GatewayRuntimeRolloutCoordinator({
      eventBus,
      repository: repository as unknown as IWorkOrderRepository,
      configStore,
      schedulerTransport,
    });

    for (let index = 0; index < 10; index += 1) {
      eventBus.emit('conversation.message.failed', { timestamp: 1700000000000 + index });
    }
    await flushAsyncWork();

    const metrics = coordinator.getMetricsSnapshot();
    expect(metrics.sessionFirst).toEqual(
      expect.objectContaining({
        conversationMessagesTotal: 10,
        conversationMessagesFailed: 10,
        conversationMessageSuccessRate: 0,
        goalsTotal: 5,
        goalsWithSessionLink: 0,
        goalSessionCoverageRate: 0,
      })
    );
    expect(configStore.save).toHaveBeenCalledTimes(1);
    expect(schedulerTransport.applyRuntimeRollout).toHaveBeenCalledTimes(1);

    coordinator.dispose();
  });

  it('forwards runtime rollout updates only when the scheduler transport is connected', async () => {
    schedulerTransport.isConnected.mockReturnValue(false);

    const coordinator = new GatewayRuntimeRolloutCoordinator({
      eventBus,
      repository: repository as unknown as IWorkOrderRepository,
      configStore,
      schedulerTransport,
    });

    await coordinator.applyRuntimeRolloutUpdate({
      deterministicRuntimeEnabled: true,
      planCompilerEnabled: true,
      toolRoutingMode: 'system_only',
      runtimeRollout: {
        shadowModeEnabled: false,
        canaryPercent: 50,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 10,
          compile: 20,
          replay: 30,
        },
      },
    });

    expect(schedulerTransport.applyRuntimeRollout).not.toHaveBeenCalled();

    coordinator.dispose();
  });
});
