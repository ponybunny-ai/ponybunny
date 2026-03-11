import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import { EventBus } from '../../../src/gateway/events/event-bus.js';
import { GatewayChannelRuntime } from '../../../src/gateway/channels/gateway-channel-runtime.js';

describe('GatewayChannelRuntime', () => {
  let tempConfigDir: string;
  let repository: IWorkOrderRepository;

  beforeEach(() => {
    tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-channel-runtime-'));
    repository = {
      getGoal: jest.fn(() => undefined),
      getWorkItem: jest.fn(() => undefined),
      getRun: jest.fn(() => undefined),
    } as unknown as IWorkOrderRepository;
  });

  afterEach(() => {
    fs.rmSync(tempConfigDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('persists session channel overrides on auth and disconnect events', () => {
    const runtime = GatewayChannelRuntime.createDefault({
      repository,
      eventBus: new EventBus(),
      configDir: tempConfigDir,
    });

    runtime.handleConnectionAuthenticated({
      sessionId: 'sess-1',
      metadata: {
        channelType: 'discord',
      },
    });

    expect(runtime.channelRouter.getSessionChannelOverrides()).toEqual({
      'sess-1': 'discord',
    });

    runtime.handleConnectionDisconnected({
      sessionId: 'sess-1',
    });

    expect(runtime.channelRouter.getSessionChannelOverrides()).toEqual({});

    const storePath = path.join(tempConfigDir, 'gateway', 'channel-sessions.json');
    expect(JSON.parse(fs.readFileSync(storePath, 'utf-8'))).toEqual({});
  });

  it('updates adapter configs, persists them, and emits sanitized config/status events', async () => {
    const eventBus = new EventBus();
    const runtime = GatewayChannelRuntime.createDefault({
      repository,
      eventBus,
      configDir: tempConfigDir,
    });
    const configEvents: Array<Record<string, unknown>> = [];
    const statusEvents: Array<Record<string, unknown>> = [];
    eventBus.on('channel.adapter.config.updated', (event) => {
      configEvents.push(event as Record<string, unknown>);
    });
    eventBus.on('channel.adapter.status.updated', (event) => {
      statusEvents.push(event as Record<string, unknown>);
    });

    await runtime.updateAdapterConfigs({
      discord: {
        botToken: 'super-secret-token',
        webhookUrl: 'https://example.test/discord-webhook',
      },
    });

    expect(runtime.getAdapterConfigs()).toMatchObject({
      discord: {
        botToken: 'super-secret-token',
        webhookUrl: 'https://example.test/discord-webhook',
      },
    });
    expect(configEvents).toHaveLength(1);
    expect(configEvents[0]).toMatchObject({
      reason: 'rpc-update',
      source: 'rpc-system.channels.update',
    });
    expect(configEvents[0].configs).toMatchObject({
      discord: {
        botToken: '***',
        webhookUrl: 'https://example.test/discord-webhook',
      },
    });
    expect(statusEvents).toHaveLength(1);

    const configPath = path.join(tempConfigDir, 'gateway', 'channel-adapter-configs.json');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toMatchObject({
      configs: {
        discord: {
          botToken: 'super-secret-token',
          webhookUrl: 'https://example.test/discord-webhook',
        },
      },
    });
  });

  it('stores channel events and mirrors adapter delivery through enabled channels', async () => {
    const runtime = GatewayChannelRuntime.createDefault({
      repository,
      eventBus: new EventBus(),
      configDir: tempConfigDir,
    });
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof globalThis.fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      runtime.applyChannelRoutingUpdate({
        enabledChannels: ['tui', 'discord'],
        mirrorToAllEnabledChannels: true,
      });
      await runtime.updateAdapterConfigs({
        discord: {
          webhookUrl: 'https://example.test/discord-webhook',
        },
      });
      await runtime.applyEnabledChannels('channel-toggle', 'channel-router');

      const report = await runtime.captureEvent('run.completed', {
        timestamp: 123,
        goalId: 'goal-1',
        runId: 'run-1',
        channelType: 'discord',
      });

      expect(report).toMatchObject({
        attempted: 1,
        delivered: 1,
        failed: [],
      });
      expect(runtime.getStoredEvents()).toHaveLength(1);
      expect(runtime.getStoredEvents()[0]).toMatchObject({
        event: 'run.completed',
        goalId: 'goal-1',
        runId: 'run-1',
        channelType: 'discord',
      });

      const fetchSpy = fetchMock as unknown as jest.Mock;
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.test/discord-webhook',
        expect.objectContaining({
          method: 'POST',
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
