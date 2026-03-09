import { ChannelAdapterManager } from '../../../src/gateway/channels/channel-adapter-manager.js';
import {
  DiscordChannelAdapter,
  EmailChannelAdapter,
  type GatewayChannelAdapter,
  type GatewayChannelAdapterStatus,
  TelegramChannelAdapter,
  WhatsappChannelAdapter,
  WebuiChannelAdapter,
} from '../../../src/gateway/channels/channel-adapter.js';

describe('ChannelAdapterManager', () => {
  it('starts adapters for enabled channels and stops disabled ones', async () => {
    const manager = new ChannelAdapterManager([
      new WebuiChannelAdapter(),
      new EmailChannelAdapter(),
      new TelegramChannelAdapter(),
      new WhatsappChannelAdapter(),
      new DiscordChannelAdapter(),
    ]);

    await manager.applyEnabledChannels(['tui', 'discord'], {
      reason: 'channel-toggle',
      source: 'channel-router',
    });

    const statuses = manager.getStatuses();
    const webui = statuses.find((item) => item.channel === 'webui');
    const discord = statuses.find((item) => item.channel === 'discord');

    expect(webui?.state).toBe('stopped');
    expect(discord?.state).toBe('running');

    await manager.applyEnabledChannels(['tui', 'webui'], {
      reason: 'channel-toggle',
      source: 'channel-router',
    });

    const nextStatuses = manager.getStatuses();
    const nextWebui = nextStatuses.find((item) => item.channel === 'webui');
    const nextDiscord = nextStatuses.find((item) => item.channel === 'discord');
    expect(nextWebui?.state).toBe('running');
    expect(nextDiscord?.state).toBe('stopped');
  });

  it('applies adapter configs and exposes them via status', async () => {
    const manager = new ChannelAdapterManager([
      new WebuiChannelAdapter(),
      new EmailChannelAdapter(),
      new TelegramChannelAdapter(),
      new WhatsappChannelAdapter(),
      new DiscordChannelAdapter(),
    ]);

    await manager.applyConfig({
      discord: { botToken: 'secret-token' },
      telegram: { webhookUrl: 'https://example.test/hook' },
      email: { inboundAddress: 'ops@example.com' },
    });

    const statusByChannel = Object.fromEntries(manager.getStatuses().map((item) => [item.channel, item]));
    expect(statusByChannel.discord.config).toEqual({
      botToken: '***',
      webhookUrl: '',
      guildId: '',
      applicationId: '',
      commandsEnabled: true,
      retryAttempts: 2,
      retryBackoffMs: 50,
    });
    expect(statusByChannel.telegram.config).toEqual({
      botToken: '',
      webhookUrl: 'https://example.test/hook',
      pollingEnabled: false,
      retryAttempts: 2,
      retryBackoffMs: 50,
    });
    expect(statusByChannel.email.config).toEqual({
      inboundAddress: 'ops@example.com',
      smtpHost: '',
      smtpPort: 587,
      useTls: true,
      retryAttempts: 2,
      retryBackoffMs: 50,
    });
  });

  it('tracks retry trail and transition metadata for failed then successful start', async () => {
    class FlakyDiscordAdapter implements GatewayChannelAdapter {
      readonly channel = 'discord' as const;
      private attempts = 0;
      private status: GatewayChannelAdapterStatus = {
        channel: 'discord',
        state: 'stopped',
        available: true,
        config: {},
        startCount: 0,
        stopCount: 0,
        errorCount: 0,
        deliveryCount: 0,
        deliveryErrorCount: 0,
      };

      async configure(): Promise<void> {
        return;
      }

      async start(): Promise<void> {
        this.attempts += 1;
        if (this.attempts === 1) {
          this.status = {
            ...this.status,
            state: 'error',
            errorCount: this.status.errorCount + 1,
            lastError: 'first attempt failed',
          };
          throw new Error('first attempt failed');
        }
        this.status = {
          ...this.status,
          state: 'running',
          startCount: this.status.startCount + 1,
          lastError: undefined,
        };
      }

      async stop(): Promise<void> {
        this.status = {
          ...this.status,
          state: 'stopped',
          stopCount: this.status.stopCount + 1,
        };
      }

      async publish(): Promise<void> {
        return;
      }

      getStatus(): GatewayChannelAdapterStatus {
        return this.status;
      }
    }

    const manager = new ChannelAdapterManager([new FlakyDiscordAdapter()]);
    await manager.applyEnabledChannels(['discord'], {
      reason: 'startup',
      source: 'gateway-startup',
    });

    const status = manager.getStatuses()[0];
    expect(status.state).toBe('running');
    expect(status.lastTransitionReason).toBe('startup');
    expect(status.lastTransitionSource).toBe('gateway-startup');
    expect(status.retryTrail?.length).toBe(2);
    expect(status.retryTrail?.[0]).toEqual(
      expect.objectContaining({ attempt: 1, outcome: 'failure', reason: 'startup', source: 'gateway-startup' })
    );
    expect(status.retryTrail?.[1]).toEqual(
      expect.objectContaining({ attempt: 2, outcome: 'success', reason: 'startup', source: 'gateway-startup' })
    );
  });

  it('honors per-channel retry policy from adapter config', async () => {
    class AlwaysFailDiscordAdapter implements GatewayChannelAdapter {
      readonly channel = 'discord' as const;
      private attempts = 0;
      private config: Record<string, unknown> = {};

      async configure(config: Record<string, unknown>): Promise<void> {
        this.config = config;
      }

      async start(): Promise<void> {
        this.attempts += 1;
        throw new Error('boom');
      }

      async stop(): Promise<void> {
        return;
      }

      async publish(): Promise<void> {
        return;
      }

      getStatus(): GatewayChannelAdapterStatus {
        return {
          channel: 'discord',
          state: 'error',
          available: true,
          config: this.config,
          startCount: 0,
          stopCount: 0,
          errorCount: this.attempts,
          deliveryCount: 0,
          deliveryErrorCount: 0,
        };
      }
    }

    const manager = new ChannelAdapterManager([new AlwaysFailDiscordAdapter()]);
    await manager.applyConfig({ discord: { retryAttempts: 1, retryBackoffMs: 0 } });

    await expect(
      manager.applyEnabledChannels(['discord'], {
        reason: 'startup',
        source: 'gateway-startup',
      })
    ).rejects.toThrow('boom');

    const status = manager.getStatuses()[0];
    expect(status.retryTrail?.length).toBe(1);
    expect(status.retryTrail?.[0]).toEqual(expect.objectContaining({ attempt: 1, outcome: 'failure' }));
  });

  it('publishes to running non-tui adapters and records delivery metrics', async () => {
    const manager = new ChannelAdapterManager([new DiscordChannelAdapter()]);
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 })) as unknown as typeof globalThis.fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await manager.applyConfig({
        discord: { webhookUrl: 'https://example.test/discord-hook' },
      });
      await manager.applyEnabledChannels(['discord'], {
        reason: 'channel-toggle',
        source: 'channel-router',
      });

      const report = await manager.publishToChannels(['tui', 'discord'], 'conversation.response', {
        goalId: 'goal-1',
        runId: 'run-1',
      });

      expect(report.attempted).toBe(1);
      expect(report.delivered).toBe(1);
      expect(report.failed).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const status = manager.getStatuses()[0];
      expect(status.deliveryCount).toBe(1);
      expect(status.deliveryErrorCount).toBe(0);
      expect(status.lastDeliveryAt).toBeDefined();
      expect(status.lastDeliveryError).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('captures publish failures without throwing from manager dispatch', async () => {
    const manager = new ChannelAdapterManager([new DiscordChannelAdapter()]);
    const fetchMock = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof globalThis.fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      await manager.applyConfig({
        discord: { webhookUrl: 'https://example.test/discord-hook' },
      });
      await manager.applyEnabledChannels(['discord'], {
        reason: 'channel-toggle',
        source: 'channel-router',
      });

      const report = await manager.publishToChannels(['discord'], 'run.completed', {
        goalId: 'goal-1',
      });

      expect(report.attempted).toBe(1);
      expect(report.delivered).toBe(0);
      expect(report.failed).toEqual([
        {
          channel: 'discord',
          error: 'discord webhook publish failed: 500',
        },
      ]);

      const status = manager.getStatuses()[0];
      expect(status.deliveryCount).toBe(0);
      expect(status.deliveryErrorCount).toBe(1);
      expect(status.lastDeliveryError).toBe('discord webhook publish failed: 500');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
