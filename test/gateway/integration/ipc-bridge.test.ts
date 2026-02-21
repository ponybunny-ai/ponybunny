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

  it('rejects immediately when scheduler daemon is not connected', async () => {
    (mockServer.getClients as jest.Mock).mockReturnValueOnce([]);
    await expect(bridge.submitGoal('goal-x')).rejects.toThrow('Scheduler daemon is not connected');
  });
});
