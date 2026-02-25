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
}): {
  ctx: CommandContext;
  app: {
    setActivityStatus: jest.Mock;
    setGoals: jest.Mock;
    setWorkItems: jest.Mock;
    setEscalations: jest.Mock;
    setSchedulerCapabilities: jest.Mock;
    addEvent: jest.Mock;
  };
  client: {
    listGoals: jest.Mock;
    listWorkItems: jest.Mock;
    listEscalations: jest.Mock;
    getSystemCapabilities: jest.Mock;
  };
} {
  const app = {
    setActivityStatus: jest.fn(),
    setGoals: jest.fn(),
    setWorkItems: jest.fn(),
    setEscalations: jest.fn(),
    setSchedulerCapabilities: jest.fn(),
    addEvent: jest.fn(),
  };

  const client = {
    listGoals: options?.listGoalsError
      ? jest.fn().mockRejectedValue(options.listGoalsError)
      : jest.fn().mockResolvedValue({ goals: [{ id: 'goal-1' }] }),
    listWorkItems: jest.fn().mockResolvedValue({ workItems: [{ id: 'wi-1' }] }),
    listEscalations: jest.fn().mockResolvedValue({ escalations: [{ id: 'esc-1' }] }),
    getSystemCapabilities: jest.fn().mockResolvedValue(buildCapabilitiesResponse()),
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
});
