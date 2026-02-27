import { executeCommand, type CommandContext } from '../../../../src/cli/tui/commands/handlers.js';
import type { SchedulerCapabilitiesResponse } from '../../../../src/cli/gateway/tui-gateway-client.js';

function buildCapabilitiesResponse(): SchedulerCapabilitiesResponse {
  return {
    timestamp: Date.now(),
    schedulerConnected: true,
    capabilities: {
      summary: {
        totalModels: 3,
        totalProviders: 2,
        totalTools: 10,
        totalMCPServers: 1,
        totalSkills: 4,
        totalAgents: 5,
      },
    },
  };
}

function createCommandContext(options?: {
  withClient?: boolean;
  listGoalsError?: Error;
  runtimeError?: Error;
  emptyGoals?: boolean;
}): {
  ctx: CommandContext;
  app: {
    setActivityStatus: jest.Mock;
    setGoals: jest.Mock;
    setWorkItems: jest.Mock;
    setEscalations: jest.Mock;
    setSchedulerCapabilities: jest.Mock;
    addEvent: jest.Mock;
    addRuntimeSnapshot: jest.Mock;
  };
  client: {
    listGoals: jest.Mock;
    listWorkItems: jest.Mock;
    listEscalations: jest.Mock;
    getSystemCapabilities: jest.Mock;
    getInternalRuntimeConfig: jest.Mock;
    getRuntimeRolloutStatus: jest.Mock;
    updateRuntimeRollout: jest.Mock;
    executeInternalRuntimeDryRun: jest.Mock;
    replayInternalRun: jest.Mock;
    getInternalRunTimeline: jest.Mock;
    getInternalRunEvents: jest.Mock;
  };
} {
  const app = {
    setActivityStatus: jest.fn(),
    setGoals: jest.fn(),
    setWorkItems: jest.fn(),
    setEscalations: jest.fn(),
    setSchedulerCapabilities: jest.fn(),
    addEvent: jest.fn(),
    addRuntimeSnapshot: jest.fn(),
  };

  const client = {
    listGoals: options?.listGoalsError
      ? jest.fn().mockRejectedValue(options.listGoalsError)
      : jest.fn().mockResolvedValue({ goals: options?.emptyGoals ? [] : [{ id: 'goal-1' }] }),
    listWorkItems: jest.fn().mockResolvedValue({ workItems: [{ id: 'wi-1' }] }),
    listEscalations: jest.fn().mockResolvedValue({ escalations: [{ id: 'esc-1' }] }),
    getSystemCapabilities: jest.fn().mockResolvedValue(buildCapabilitiesResponse()),
    getInternalRuntimeConfig: jest.fn().mockResolvedValue({
      deterministicRuntimeEnabled: true,
      planCompilerEnabled: true,
      toolRoutingMode: 'system_only',
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
    }),
    getRuntimeRolloutStatus: jest.fn().mockResolvedValue({
      mode: 'legacy',
      rollout: {
        shadowModeEnabled: false,
        canaryPercent: 0,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 0,
          compile: 0,
          replay: 0,
        },
      },
      metrics: {
        dryRunsTotal: 3,
        dryRunsSucceeded: 2,
        dryRunsFailed: 1,
        successRate: 2 / 3,
        averagePlanStepCount: 4,
        averageChangedStepCount: 1,
        failureCodeCounts: {
          ERR_TOOL_NOT_FOUND: 1,
        },
      },
      schedulerFlags: {
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
      },
    }),
    updateRuntimeRollout: jest.fn().mockResolvedValue({
      mode: 'canary',
      rollout: {
        shadowModeEnabled: false,
        canaryPercent: 20,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 20,
          compile: 0,
          replay: 0,
        },
      },
      metrics: {
        dryRunsTotal: 5,
        dryRunsSucceeded: 4,
        dryRunsFailed: 1,
        successRate: 0.8,
        averagePlanStepCount: 4,
        averageChangedStepCount: 1,
        failureCodeCounts: {
          ERR_TOOL_NOT_FOUND: 1,
        },
      },
      schedulerFlags: {
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
      },
    }),
    executeInternalRuntimeDryRun: options?.runtimeError
      ? jest.fn().mockRejectedValue(options.runtimeError)
      : jest.fn().mockResolvedValue({ ok: true, report: { status: 'pass' } }),
    replayInternalRun: jest.fn().mockResolvedValue({
      status: 'completed',
      summary: {
        total_events: 6,
      },
      reexecution: {
        attempted_steps: 0,
        eligible_steps: 0,
        executed_steps: 0,
        skipped: [],
      },
    }),
    getInternalRunTimeline: jest.fn().mockResolvedValue({ status: 'completed' }),
    getInternalRunEvents: jest.fn().mockResolvedValue({ returned: 6, offset: 0, nextCursor: '6' }),
  };

  const ctx = {
    app: {
      ...app,
      state: { goals: [], escalations: [] },
    },
    gateway: {
      client: options?.withClient === false ? null : client,
      connectionStatus: 'connected',
      url: 'ws://127.0.0.1:18789',
      connect: jest.fn(),
      disconnect: jest.fn(),
    },
    exit: jest.fn(),
  } as unknown as CommandContext;

  return { ctx, app, client };
}

describe('TUI command handlers - refresh', () => {
  it('refreshes scheduler data via gateway and updates app state', async () => {
    const { ctx, app, client } = createCommandContext();

    const result = await executeCommand('/refresh', ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Refreshed scheduler data');
    expect(client.listGoals).toHaveBeenCalledTimes(1);
    expect(client.listWorkItems).toHaveBeenCalledTimes(1);
    expect(client.listEscalations).toHaveBeenCalledTimes(1);
    expect(client.getSystemCapabilities).toHaveBeenCalledTimes(1);
    expect(app.setGoals).toHaveBeenCalledWith([{ id: 'goal-1' }]);
    expect(app.setWorkItems).toHaveBeenCalledWith([{ id: 'wi-1' }]);
    expect(app.setEscalations).toHaveBeenCalledWith([{ id: 'esc-1' }]);
    expect(app.setSchedulerCapabilities).toHaveBeenCalledTimes(1);
    expect(app.addEvent).toHaveBeenCalledWith('scheduler.refreshed', expect.any(Object));
    expect(app.setActivityStatus).toHaveBeenNthCalledWith(1, 'refreshing scheduler data...');
    expect(app.setActivityStatus).toHaveBeenLastCalledWith('idle');
  });

  it('returns error when gateway client is unavailable', async () => {
    const { ctx, app } = createCommandContext({ withClient: false });

    const result = await executeCommand('/refresh', ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not connected to gateway');
    expect(app.setActivityStatus).not.toHaveBeenCalled();
  });

  it('returns refresh failure when gateway call throws', async () => {
    const { ctx, app, client } = createCommandContext({
      listGoalsError: new Error('gateway unavailable'),
    });

    const result = await executeCommand('/refresh', ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Refresh failed: gateway unavailable');
    expect(client.listGoals).toHaveBeenCalledTimes(1);
    expect(app.setGoals).not.toHaveBeenCalled();
    expect(app.setWorkItems).not.toHaveBeenCalled();
    expect(app.setEscalations).not.toHaveBeenCalled();
    expect(app.setSchedulerCapabilities).not.toHaveBeenCalled();
    expect(app.setActivityStatus).toHaveBeenLastCalledWith('idle');
  });

  it('refreshes runtime data with dry run when /refresh runtime is used', async () => {
    const { ctx, app, client } = createCommandContext();

    const result = await executeCommand('/refresh runtime', ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Runtime refreshed');
    expect(client.getInternalRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(client.getRuntimeRolloutStatus).toHaveBeenCalledTimes(1);
    expect(client.executeInternalRuntimeDryRun).toHaveBeenCalledWith({ goalId: 'goal-1' });
    expect(app.addEvent).toHaveBeenCalledWith('runtime.refreshed', expect.objectContaining({
      dryRunGoalId: 'goal-1',
      dryRunOk: true,
    }));
    expect(app.addRuntimeSnapshot).toHaveBeenCalledTimes(1);
    expect(app.setActivityStatus).toHaveBeenNthCalledWith(1, 'refreshing runtime data...');
    expect(app.setActivityStatus).toHaveBeenLastCalledWith('idle');
  });

  it('supports /refresh runtime <goalId> explicit goal selection', async () => {
    const { ctx, client } = createCommandContext();

    const result = await executeCommand('/refresh runtime goal-42', ctx);

    expect(result.success).toBe(true);
    expect(client.executeInternalRuntimeDryRun).toHaveBeenCalledWith({ goalId: 'goal-42' });
  });

  it('handles runtime refresh when no goals exist', async () => {
    const { ctx, app, client } = createCommandContext({ emptyGoals: true });

    const result = await executeCommand('/refresh runtime', ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('no goals available');
    expect(client.executeInternalRuntimeDryRun).not.toHaveBeenCalled();
    expect(app.addEvent).toHaveBeenCalledWith('runtime.refreshed', expect.objectContaining({ dryRun: false }));
  });

  it('returns runtime refresh failure when runtime call throws', async () => {
    const { ctx } = createCommandContext({ runtimeError: new Error('runtime unavailable') });

    const result = await executeCommand('/refresh runtime', ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Runtime refresh failed: runtime unavailable');
  });

  it('loads timeline/event diagnostics when dry run replay includes run ids', async () => {
    const { ctx, app, client } = createCommandContext();
    client.executeInternalRuntimeDryRun.mockResolvedValueOnce({
      ok: true,
      report: { status: 'pass' },
      replay: {
        summary: {
          compile_run_id: 'compile-1',
          runtime_run_id: 'run-1',
          total_events: 6,
          facts_count: 2,
          artifacts_count: 1,
        },
      },
    });

    const result = await executeCommand('/refresh runtime goal-77', ctx);

    expect(result.success).toBe(true);
    expect(client.getInternalRunTimeline).toHaveBeenCalledWith('run-1', 'compile-1');
    expect(client.replayInternalRun).toHaveBeenCalledWith(
      'run-1',
      'compile-1',
      'reexecute_tools',
      { maxAttempts: 20 }
    );
    expect(client.getInternalRunEvents).toHaveBeenCalledWith({
      runId: 'run-1',
      relatedRunId: 'compile-1',
      limit: 50,
      offset: 0,
    });
    expect(app.addRuntimeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'goal-77',
      runId: 'run-1',
      dryRun: expect.objectContaining({
        compileRunId: 'compile-1',
        runtimeRunId: 'run-1',
        totalEvents: 6,
        factsCount: 2,
        artifactsCount: 1,
        reexecution: {
          attemptedSteps: 0,
          eligibleSteps: 0,
          executedSteps: 0,
          skippedSteps: 0,
        },
      }),
    }));
    expect(app.addEvent).toHaveBeenCalledWith('runtime.refreshed', expect.objectContaining({
      timelineStatus: 'completed',
      returnedEvents: 6,
      compileRunId: 'compile-1',
      runtimeRunId: 'run-1',
    }));
  });
});

describe('TUI command handlers - rollout', () => {
  it('returns rollout status with /rollout status', async () => {
    const { ctx, app, client } = createCommandContext();

    const result = await executeCommand('/rollout status', ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Rollout mode=legacy');
    expect(client.getRuntimeRolloutStatus).toHaveBeenCalledTimes(1);
    expect(app.addEvent).toHaveBeenCalledWith('runtime.rollout.status', expect.any(Object));
  });

  it('updates rollout settings with /rollout set', async () => {
    const { ctx, app, client } = createCommandContext();

    const result = await executeCommand('/rollout set shadow=true canary=20 rollback=false', ctx);

    expect(result.success).toBe(true);
    expect(client.updateRuntimeRollout).toHaveBeenCalledWith({
      shadowModeEnabled: true,
      canaryPercent: 20,
      rollbackOnFailure: false,
    });
    expect(app.addEvent).toHaveBeenCalledWith('runtime.rollout.updated', expect.objectContaining({
      action: 'set',
    }));
  });

  it('rolls back rollout with /rollout rollback', async () => {
    const { ctx, app, client } = createCommandContext();

    const result = await executeCommand('/rollout rollback', ctx);

    expect(result.success).toBe(true);
    expect(client.updateRuntimeRollout).toHaveBeenCalledWith({ rollbackToLegacy: true });
    expect(app.addEvent).toHaveBeenCalledWith('runtime.rollout.updated', expect.objectContaining({
      action: 'rollback',
    }));
  });

  it('returns validation error for invalid /rollout set arguments', async () => {
    const { ctx, client } = createCommandContext();

    const result = await executeCommand('/rollout set canary=200', ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Rollout command failed');
    expect(client.updateRuntimeRollout).not.toHaveBeenCalled();
  });
});

describe('TUI command handlers - replay', () => {
  it('executes replay with default mode and emits runtime event', async () => {
    const { ctx, app, client } = createCommandContext();
    client.replayInternalRun.mockResolvedValueOnce({
      status: 'completed',
      summary: { total_events: 8 },
      reexecution: {
        attempted_steps: 3,
        eligible_steps: 2,
        executed_steps: 1,
        skipped: [{ tool: 'local://x', reason: 'execution_disabled' }],
      },
    });

    const result = await executeCommand('/replay run-1', ctx);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Replay reexecute_tools status=completed');
    expect(result.message).toContain('pageReturned=6');
    expect(client.replayInternalRun).toHaveBeenCalledWith('run-1', undefined, 'reexecute_tools', {
      allowTools: undefined,
      maxAttempts: undefined,
      enableExecution: undefined,
    });
    expect(client.getInternalRunEvents).toHaveBeenCalledWith({
      runId: 'run-1',
      limit: 50,
      offset: 0,
    });
    expect(client.getInternalRuntimeConfig).toHaveBeenCalledTimes(1);
    expect(app.addRuntimeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      goalId: 'replay:run-1',
      runId: 'run-1',
      dryRun: expect.objectContaining({
        status: 'completed',
        totalEvents: 8,
        reexecution: {
          attemptedSteps: 3,
          eligibleSteps: 2,
          executedSteps: 1,
          skippedSteps: 1,
        },
        replayPage: {
          returned: 6,
          offset: 0,
          cursor: undefined,
          nextOffset: undefined,
          nextCursor: '6',
        },
      }),
    }));
    expect(app.addEvent).toHaveBeenCalledWith('runtime.replay.executed', expect.objectContaining({
      runId: 'run-1',
      mode: 'reexecute_tools',
    }));
  });

  it('executes replay with related run and explicit options', async () => {
    const { ctx, client } = createCommandContext();
    client.replayInternalRun.mockResolvedValueOnce({
      status: 'in_progress',
      summary: { total_events: 4 },
    });

    const result = await executeCommand(
      '/replay run-1 run-2 mode=facts_only allowTools=local://read_file maxAttempts=5 enableExecution=true',
      ctx
    );

    expect(result.success).toBe(true);
    expect(client.replayInternalRun).toHaveBeenCalledWith('run-1', 'run-2', 'facts_only', {
      allowTools: ['local://read_file'],
      maxAttempts: 5,
      enableExecution: true,
    });
    expect(client.getInternalRunEvents).toHaveBeenCalledWith({
      runId: 'run-1',
      relatedRunId: 'run-2',
      limit: 50,
      offset: 0,
    });
  });

  it('supports replay pagination options eventsLimit/cursor', async () => {
    const { ctx, client } = createCommandContext();

    const result = await executeCommand('/replay run-1 mode=reexecute_tools eventsLimit=25 cursor=12', ctx);

    expect(result.success).toBe(true);
    expect(client.getInternalRunEvents).toHaveBeenCalledWith({
      runId: 'run-1',
      limit: 25,
      cursor: '12',
    });
  });

  it('returns validation errors for malformed replay command options', async () => {
    const { ctx, client } = createCommandContext();

    const missingRun = await executeCommand('/replay', ctx);
    expect(missingRun.success).toBe(false);
    expect(missingRun.error).toContain('Run ID is required');

    const malformed = await executeCommand('/replay run-1 maxAttempts=0', ctx);
    expect(malformed.success).toBe(false);
    expect(malformed.error).toContain('Replay command failed');
    expect(client.replayInternalRun).not.toHaveBeenCalledWith(
      'run-1',
      undefined,
      'reexecute_tools',
      expect.objectContaining({ maxAttempts: 0 })
    );

    const badEventsLimit = await executeCommand('/replay run-1 eventsLimit=0', ctx);
    expect(badEventsLimit.success).toBe(false);
    expect(badEventsLimit.error).toContain('Replay command failed');
  });
});
