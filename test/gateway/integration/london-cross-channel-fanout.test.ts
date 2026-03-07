import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';

jest.mock('../../../src/gateway/auth/signature-verifier.js', () => ({
  SignatureVerifier: class {
    async verify(): Promise<boolean> {
      return true;
    }
  },
}));

import { GatewayServer } from '../../../src/gateway/gateway-server.js';
import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { registerConversationHandlers } from '../../../src/gateway/rpc/handlers/conversation-handlers.js';
import { Session } from '../../../src/gateway/connection/session.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { IPCBridge } from '../../../src/gateway/integration/ipc-bridge.js';
import type { ChannelAdapterManager } from '../../../src/gateway/channels/channel-adapter-manager.js';

function createAdminSession(id: string, channelType: 'tui' | 'discord' = 'discord'): Session {
  return new Session({
    id,
    publicKey: `pk-${id}`,
    permissions: ['read', 'write', 'admin'],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    metadata: {
      channelType,
      channelSessionId: `${channelType}-session-${id}`,
    },
  });
}

describe('session-first London flow cross-channel fanout', () => {
  it('publishes final result event to enabled non-TUI channel via policy fanout', async () => {
    const tempConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-fanout-test-'));
    const previousConfigDir = process.env.PONYBUNNY_CONFIG_DIR;
    process.env.PONYBUNNY_CONFIG_DIR = tempConfigRoot;

    const db = new Database(':memory:');
    const repository = {
      listGoals: jest.fn(() => []),
      getGoal: jest.fn(() => undefined),
      getWorkItem: jest.fn(() => undefined),
      getRun: jest.fn(() => undefined),
    } as unknown as IWorkOrderRepository;

    const gateway = new GatewayServer({
      db,
      repository,
    });

    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof globalThis.fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const gatewayInternals = gateway as unknown as { rpcHandler: RpcHandler; channelAdapterManager: ChannelAdapterManager };
      const admin = createAdminSession('admin-control', 'tui');

      await gatewayInternals.rpcHandler.handle(
        'system.channels.update',
        {
          enabledChannels: ['tui', 'discord'],
          mirrorToAllEnabledChannels: true,
          adapterConfigs: {
            discord: {
              webhookUrl: 'https://example.test/discord-webhook',
            },
          },
        },
        admin
      );

      const conversationRpc = new RpcHandler();
      const eventBus = gateway.getEventBus();
      const fakeIpcBridge = {
        openSession: jest.fn(async () => ({
          sessionId: 'ses-london-fanout',
          personaId: 'pony-default',
          state: 'chatting',
          lifecycleState: 'active',
        })),
        listSessions: jest.fn(async () => ({ sessions: [] })),
        sendSessionMessage: jest.fn(async (params: { gatewaySessionId?: string; sessionId?: string; message: string }) => {
          eventBus.emit('run.completed', {
            gatewaySessionId: params.gatewaySessionId,
            sessionId: params.sessionId,
            goalId: 'goal-london-fanout',
            runId: 'run-london-fanout',
            status: 'completed',
            success: true,
            channelType: 'discord',
            timestamp: Date.now(),
            result: {
              summary: 'London forecast fetched and shell script executed successfully.',
            },
          });

          return {
            sessionId: params.sessionId ?? 'ses-london-fanout',
            response: 'Done. Script created in home directory and execution completed.',
            state: 'chatting',
            decision: 'goal_created' as const,
            decisionReason: 'actionable automation request',
            taskInfo: {
              goalId: 'goal-london-fanout',
              status: 'queued',
              progress: 0,
            },
          };
        }),
        getSessionHistory: jest.fn(async () => ({ turns: [] })),
        endSession: jest.fn(async () => ({ success: true })),
        archiveSession: jest.fn(async () => ({ success: true })),
        resumeSession: jest.fn(async () => ({ success: true })),
        getSessionStatus: jest.fn(async () => ({ exists: true })),
      };

      registerConversationHandlers(conversationRpc, eventBus, fakeIpcBridge as unknown as IPCBridge);

      const londonSession = createAdminSession('gateway-session-london', 'discord');
      await conversationRpc.handle('conversation.new', {}, londonSession);
      await conversationRpc.handle(
        'conversation.message',
        {
          sessionId: 'ses-london-fanout',
          message: '我想知道后天London是否下雨。写一个shell脚本来实现这个功能，并且将脚本保存到当前用户的home目录下，运行后给我最终的结果。',
        },
        londonSession
      );

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetchMockFn = fetchMock as unknown as jest.Mock;
      const [url, options] = fetchMockFn.mock.calls[0] as [string, { method: string; body: string }];
      expect(url).toBe('https://example.test/discord-webhook');
      expect(options.method).toBe('POST');
      expect(options.body).toContain('run.completed');
      expect(options.body).toContain('goal-london-fanout');

      expect(fakeIpcBridge.sendSessionMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewaySessionId: 'gateway-session-london',
          channelType: 'discord',
        })
      );

      const discordStatus = gateway.getChannelAdapterStatuses().find((status) => status.channel === 'discord');
      expect(discordStatus).toBeDefined();
      expect(discordStatus?.deliveryCount).toBeGreaterThanOrEqual(1);
      expect(discordStatus?.deliveryErrorCount).toBe(0);

      await gatewayInternals.channelAdapterManager.stopAll({
        reason: 'shutdown',
        source: 'gateway-stop',
      });
    } finally {
      await gateway.getAuditService().shutdown();
      globalThis.fetch = originalFetch;
      db.close();
      if (previousConfigDir === undefined) {
        delete process.env.PONYBUNNY_CONFIG_DIR;
      } else {
        process.env.PONYBUNNY_CONFIG_DIR = previousConfigDir;
      }
      fs.rmSync(tempConfigRoot, { recursive: true, force: true });
    }
  });
});
