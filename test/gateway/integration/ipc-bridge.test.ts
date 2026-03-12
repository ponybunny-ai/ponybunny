import { IPCBridge } from '../../../src/gateway/integration/ipc-bridge.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import type { IPCServer, IPCMessageHandler } from '../../../src/ipc/ipc-server.js';

describe('IPCBridge scheduler commands', () => {
  let bridge: IPCBridge;
  let mockEventBus: EventBus;
  let mockServer: IPCServer;
  let serverMessageHandler: IPCMessageHandler | null;

  beforeEach(() => {
    serverMessageHandler = null;

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    mockServer = {
      onMessage: jest.fn((handler: IPCMessageHandler) => {
        serverMessageHandler = handler;
      }),
      offMessage: jest.fn(),
      getClients: jest.fn(() => [
        {
          id: 'client-1',
          connectedAt: Date.now(),
          clientInfo: {
            clientType: 'scheduler-daemon',
            version: '1.0.0',
            pid: 42,
          },
        },
      ]),
      sendToClient: jest.fn(),
      getConnectedClients: jest.fn(() => 1),
      start: jest.fn(),
      stop: jest.fn(),
    } as unknown as IPCServer;

    bridge = new IPCBridge(mockEventBus);
    bridge.connect(mockServer);
  });

  it('sends submit_goal command and resolves on success response', async () => {
    const submitPromise = bridge.submitGoal('goal-123');

    expect(mockServer.sendToClient).toHaveBeenCalledTimes(1);
    const message = (mockServer.sendToClient as jest.Mock).mock.calls[0][1];
    expect(message.type).toBe('scheduler_command');
    expect(message.data.command).toBe('submit_goal');
    expect(message.data.goalId).toBe('goal-123');

    serverMessageHandler?.(
      {
        type: 'scheduler_command_result',
        timestamp: Date.now(),
        data: {
          requestId: message.data.requestId,
          success: true,
        },
      },
      'client-1'
    );

    await expect(submitPromise).resolves.toBeUndefined();
  });

  it('sends cancel_goal command and rejects on failure response', async () => {
    const cancelPromise = bridge.cancelGoal('goal-555', 'User cancelled');

    expect(mockServer.sendToClient).toHaveBeenCalledTimes(1);
    const message = (mockServer.sendToClient as jest.Mock).mock.calls[0][1];
    expect(message.type).toBe('scheduler_command');
    expect(message.data.command).toBe('cancel_goal');
    expect(message.data.goalId).toBe('goal-555');
    expect(message.data.reason).toBe('User cancelled');

    serverMessageHandler?.(
      {
        type: 'scheduler_command_result',
        timestamp: Date.now(),
        data: {
          requestId: message.data.requestId,
          success: false,
          error: 'cancel failed',
        },
      },
      'client-1'
    );

    await expect(cancelPromise).rejects.toThrow('cancel failed');
  });

  it('sends apply_runtime_rollout command', async () => {
    const applyPromise = bridge.applyRuntimeRollout({
      deterministicRuntimeEnabled: true,
      planCompilerEnabled: true,
      toolRoutingMode: 'system_only',
      runtimeRollout: {
        shadowModeEnabled: true,
        canaryPercent: 10,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 10,
          compile: 10,
          replay: 0,
        },
      },
    });

    expect(mockServer.sendToClient).toHaveBeenCalledTimes(1);
    const message = (mockServer.sendToClient as jest.Mock).mock.calls[0][1];
    expect(message.type).toBe('scheduler_command');
    expect(message.data.command).toBe('apply_runtime_rollout');

    serverMessageHandler?.(
      {
        type: 'scheduler_command_result',
        timestamp: Date.now(),
        data: {
          requestId: message.data.requestId,
          success: true,
        },
      },
      'client-1'
    );

    await expect(applyPromise).resolves.toBeUndefined();
  });

  it('rejects immediately when scheduler daemon is not connected', async () => {
    (mockServer.getClients as jest.Mock).mockReturnValueOnce([]);
    await expect(bridge.submitGoal('goal-x')).rejects.toThrow('Scheduler daemon is not connected');
  });

  it('allows session_message commands to take longer than the default timeout', async () => {
    jest.useFakeTimers();

    try {
      const sessionMessagePromise = bridge.sendSessionMessage({
        gatewaySessionId: 'gateway-session-1',
        sessionId: 'session-1',
        message: 'how are you?',
      });

      expect(mockServer.sendToClient).toHaveBeenCalledTimes(1);
      const message = (mockServer.sendToClient as jest.Mock).mock.calls[0][1];
      expect(message.data.command).toBe('session_message');

      jest.advanceTimersByTime(10_000);

      serverMessageHandler?.(
        {
          type: 'scheduler_command_result',
          timestamp: Date.now(),
          data: {
            requestId: message.data.requestId,
            success: true,
            result: {
              sessionId: 'session-1',
              response: 'I am doing well.',
              state: 'idle',
            },
          },
        },
        'client-1'
      );

      await expect(sessionMessagePromise).resolves.toEqual({
        sessionId: 'session-1',
        response: 'I am doing well.',
        state: 'idle',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the shorter timeout for non-conversation scheduler commands', async () => {
    jest.useFakeTimers();

    try {
      const submitPromise = bridge.submitGoal('goal-timeout');
      jest.advanceTimersByTime(5_001);

      await expect(submitPromise).rejects.toThrow('Scheduler command timed out: submit_goal');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('IPCBridge scheduler event routing', () => {
  let bridge: IPCBridge;
  let mockEventBus: EventBus;
  let mockServer: IPCServer;
  let serverMessageHandler: IPCMessageHandler | null;

  beforeEach(() => {
    serverMessageHandler = null;

    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    mockServer = {
      onMessage: jest.fn((handler: IPCMessageHandler) => {
        serverMessageHandler = handler;
      }),
      offMessage: jest.fn(),
      getClients: jest.fn(() => [
        {
          id: 'client-1',
          connectedAt: Date.now(),
          clientInfo: {
            clientType: 'scheduler-daemon',
            version: '1.0.0',
            pid: 42,
          },
        },
      ]),
      sendToClient: jest.fn(),
      getConnectedClients: jest.fn(() => 1),
      start: jest.fn(),
      stop: jest.fn(),
    } as unknown as IPCServer;

    bridge = new IPCBridge(mockEventBus);
    bridge.connect(mockServer);
  });

  it('routes work_item_in_progress scheduler events to gateway event bus', () => {
    serverMessageHandler?.(
      {
        type: 'scheduler_event',
        timestamp: Date.now(),
        data: {
          type: 'work_item_in_progress',
          timestamp: 123,
          goalId: 'goal-1',
          workItemId: 'wi-1',
          runId: 'run-1',
          data: { stage: 'execution', progress: 35 },
        },
      },
      'client-1'
    );

    expect(mockEventBus.emit).toHaveBeenCalledWith('workitem.in_progress', {
      workItemId: 'wi-1',
      goalId: 'goal-1',
      runId: 'run-1',
      stage: 'execution',
      progress: 35,
      timestamp: 123,
    });
  });

  it('propagates scheduler envelope fields into routed events', () => {
    serverMessageHandler?.(
      {
        type: 'scheduler_event',
        timestamp: Date.now(),
        data: {
          type: 'run_started',
          timestamp: 777,
          goalId: 'goal-1',
          workItemId: 'wi-1',
          runId: 'run-1',
          data: {
            selected_model: 'gpt',
            sessionId: 'session-1',
            channelType: 'discord',
            channelSessionId: 'discord-1',
          },
        },
      },
      'client-1'
    );

    expect(mockEventBus.emit).toHaveBeenCalledWith('run.started', {
      runId: 'run-1',
      workItemId: 'wi-1',
      goalId: 'goal-1',
      selectedModel: 'gpt',
      sessionId: 'session-1',
      channelType: 'discord',
      channelSessionId: 'discord-1',
      timestamp: 777,
    });
  });

  it('routes work_item_ended scheduler events to gateway event bus', () => {
    serverMessageHandler?.(
      {
        type: 'scheduler_event',
        timestamp: Date.now(),
        data: {
          type: 'work_item_ended',
          timestamp: 456,
          goalId: 'goal-1',
          workItemId: 'wi-1',
          runId: 'run-1',
          data: { outcome: 'failure', error: 'x' },
        },
      },
      'client-1'
    );

    expect(mockEventBus.emit).toHaveBeenCalledWith('workitem.ended', {
      workItemId: 'wi-1',
      goalId: 'goal-1',
      runId: 'run-1',
      outcome: 'failure',
      error: 'x',
      timestamp: 456,
    });
  });

  it('routes run_event_retention messages to gateway event bus', () => {
    serverMessageHandler?.(
      {
        type: 'run_event_retention',
        timestamp: Date.now(),
        data: {
          deleted: 3,
          ok: true,
          timestamp: 123,
        },
      },
      'client-1'
    );

    expect(mockEventBus.emit).toHaveBeenCalledWith('runtime.retention.run', {
      deleted: 3,
      ok: true,
      timestamp: 123,
    });
  });
});
