import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { GatewayError, ErrorCodes } from '../../../src/gateway/errors.js';
import { registerSystemHandlers } from '../../../src/gateway/rpc/handlers/system-handlers.js';
import type { ConnectionManager } from '../../../src/gateway/connection/connection-manager.js';
import type { ISchedulerCore } from '../../../src/scheduler/core/index.js';

const getSchedulerCapabilitiesMock = jest.fn();

jest.mock('../../../src/infra/scheduler/capabilities.js', () => ({
  getSchedulerCapabilities: (...args: unknown[]) => getSchedulerCapabilitiesMock(...args),
}));

function createSession(permissions: Array<'read' | 'write' | 'admin'>): Session {
  return new Session({
    id: 'sess-1',
    publicKey: 'pk-test',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

describe('system handlers', () => {
  let rpc: RpcHandler;
  let mockConnectionManager: ConnectionManager;
  let mockScheduler: ISchedulerCore;

  beforeEach(() => {
    rpc = new RpcHandler();

    mockConnectionManager = {
      getStats: jest.fn(() => ({
        totalSessions: 1,
        pendingConnections: 0,
        uniqueIps: 1,
        connectionsByIp: { '127.0.0.1': 1 },
      })),
    } as unknown as ConnectionManager;

    mockScheduler = {
      getState: jest.fn(() => ({
        status: 'running',
        activeGoals: ['goal-1'],
        lastTickAt: Date.now(),
        errorCount: 0,
      })),
      getMetrics: jest.fn(() => ({
        totalGoalsProcessed: 10,
        totalWorkItemsCompleted: 20,
        totalRunsExecuted: 25,
        averageWorkItemDurationMs: 100,
        successRate: 0.95,
        currentActiveGoals: 1,
        currentActiveWorkItems: 1,
      })),
      on: jest.fn(),
      off: jest.fn(),
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      submitGoal: jest.fn(),
      cancelGoal: jest.fn(),
      getGoalState: jest.fn(),
      getAllGoalStates: jest.fn(),
      tick: jest.fn(),
    } as unknown as ISchedulerCore;

    getSchedulerCapabilitiesMock.mockReset();
    getSchedulerCapabilitiesMock.mockReturnValue({
      models: [],
      providers: [],
      tools: [],
      mcpServers: [],
      skills: [],
      agents: [{ id: 'lead', name: 'Lead', type: 'planner', enabled: true, source: 'user', status: 'valid', scheduleKind: 'interval' }],
      summary: {
        totalModels: 0,
        totalProviders: 0,
        totalTools: 0,
        totalMCPServers: 0,
        totalSkills: 0,
        totalAgents: 1,
      },
    });

    registerSystemHandlers(
      rpc,
      () => mockConnectionManager,
      () => mockScheduler,
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true })
    );
  });

  it('returns system.capabilities for read sessions', async () => {
    const session = createSession(['read']);

    const result = await rpc.handle('system.capabilities', {}, session);

    expect(getSchedulerCapabilitiesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        schedulerConnected: true,
        capabilities: expect.objectContaining({
          summary: expect.objectContaining({ totalAgents: 1 }),
        }),
      })
    );
  });

  it('denies system.capabilities when read permission is missing', async () => {
    const session = createSession([]);

    await expect(rpc.handle('system.capabilities', {}, session)).rejects.toMatchObject<Partial<GatewayError>>({
      code: ErrorCodes.PERMISSION_DENIED,
    });
  });

  it('reports schedulerConnected false when scheduler is unavailable', async () => {
    const rpcWithoutScheduler = new RpcHandler();
    registerSystemHandlers(
      rpcWithoutScheduler,
      () => mockConnectionManager,
      () => null,
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: false })
    );

    const result = await rpcWithoutScheduler.handle('system.capabilities', {}, createSession(['read']));

    expect(result).toEqual(
      expect.objectContaining({
        schedulerConnected: false,
      })
    );
  });
});
