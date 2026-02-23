import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { ProcessSubagentManager } from '../../../src/infra/agents/subagent-process-manager.js';

const spawnMock = jest.fn();
const ensureAgentWorkdirMock = jest.fn();

jest.mock('node:child_process', () => ({
  fork: (...args: unknown[]) => spawnMock(...args),
}));

jest.mock('../../../src/infra/agents/agent-workdir.js', () => ({
  ensureAgentWorkdir: (...args: unknown[]) => ensureAgentWorkdirMock(...args),
}));

const createChildProcess = (pid: number): ChildProcess => {
  const emitter = new EventEmitter() as unknown as ChildProcess & {
    pid: number;
    kill: (signal?: NodeJS.Signals | number) => boolean;
    send: jest.Mock<boolean, [unknown]>;
    killed: boolean;
    exitCode: number | null;
  };

  emitter.pid = pid;
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.kill = () => {
    emitter.killed = true;
    emitter.exitCode = 0;
    emitter.emit('exit', 0);
    return true;
  };
  emitter.send = jest.fn((message: unknown) => {
    const typed = message as { type?: string };
    if (typed?.type === 'init') {
      emitter.emit('message', { type: 'ready', payload: { subagentId: 'scout', runKey: 'run-1' } });
    }
    if (typed?.type === 'shutdown') {
      emitter.emit('message', { type: 'shutdown_ack', payload: { subagentId: 'scout' } });
      emitter.emit('exit', 0);
    }
    return true;
  });

  return emitter;
};

describe('ProcessSubagentManager', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    ensureAgentWorkdirMock.mockReset();
    ensureAgentWorkdirMock.mockReturnValue('/tmp/pony-subagent-workdir');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('spawns configured subagents with parent metadata and stops them', async () => {
    const child = createChildProcess(1234);
    spawnMock.mockReturnValue(child);

    const registry = {
      getAgent: (id: string) => ({
        id,
        config: { enabled: true, workdir: './work' },
        configPath: `/tmp/${id}/agent.json`,
      }),
    };

    const manager = new ProcessSubagentManager(() => registry as never, {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    });

    const started = await manager.startSubagents({
      agentId: 'lead',
      runKey: 'run-1',
      goalId: 'goal-1',
      subAgents: ['scout'],
    });

    expect(started).toHaveLength(1);
    expect(started[0].subagentId).toBe('scout');
    expect(started[0].pid).toBe(1234);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(spawnArgs[0]).toContain('subagent-worker.js');
    expect(spawnArgs[2]).toEqual(
      expect.objectContaining({
        cwd: '/tmp/pony-subagent-workdir',
        env: expect.objectContaining({
          PONY_PARENT_AGENT_ID: 'lead',
          PONY_SUBAGENT_ID: 'scout',
          PONY_RUN_KEY: 'run-1',
          PONY_GOAL_ID: 'goal-1',
        }),
      })
    );

    await manager.stopSubagents(started);
    expect((child as unknown as { send: jest.Mock }).send).toHaveBeenCalledWith({ type: 'shutdown' });
  });

  it('skips missing subagent definitions', async () => {
    const manager = new ProcessSubagentManager(
      () => ({ getAgent: () => undefined }) as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    );

    const started = await manager.startSubagents({
      agentId: 'lead',
      runKey: 'run-2',
      subAgents: ['missing'],
    });

    expect(started).toHaveLength(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('updates heartbeat snapshot from child heartbeat messages', async () => {
    const child = createChildProcess(2233);
    spawnMock.mockReturnValue(child);

    const manager = new ProcessSubagentManager(
      () => ({
        getAgent: (id: string) => ({
          id,
          config: { enabled: true },
          configPath: `/tmp/${id}/agent.json`,
        }),
      }) as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    );

    const started = await manager.startSubagents({
      agentId: 'lead',
      runKey: 'run-heartbeat',
      subAgents: ['scout'],
    });

    const before = manager.getHeartbeatSnapshot(started)[0];
    child.emit('message', {
      type: 'heartbeat',
      payload: {
        subagentId: 'scout',
        runKey: 'run-heartbeat',
        timestamp: before.lastHeartbeatAtMs + 2000,
      },
    });

    const after = manager.getHeartbeatSnapshot(started)[0];
    expect(after.lastHeartbeatAtMs).toBeGreaterThan(before.lastHeartbeatAtMs);
    expect(after.stale).toBe(false);

    await manager.stopSubagents(started);
  });

  it('terminates subagent when heartbeat becomes stale', async () => {
    jest.useFakeTimers();
    const child = createChildProcess(3344);
    spawnMock.mockReturnValue(child);

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const manager = new ProcessSubagentManager(
      () => ({
        getAgent: (id: string) => ({
          id,
          config: { enabled: true },
          configPath: `/tmp/${id}/agent.json`,
        }),
      }) as never,
      logger,
      { heartbeatStaleMs: 100, heartbeatCheckMs: 25 }
    );

    const startedPromise = manager.startSubagents({
      agentId: 'lead',
      runKey: 'run-stale',
      subAgents: ['scout'],
    });
    await jest.runOnlyPendingTimersAsync();
    const started = await startedPromise;

    await jest.advanceTimersByTimeAsync(250);
    expect(child.killed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      '[SubagentProcessManager] Subagent heartbeat stale; terminating process',
      expect.objectContaining({
        subagentId: 'scout',
        pid: 3344,
        parentAgentId: 'lead',
      })
    );

    await manager.stopSubagents(started);
  });
});
