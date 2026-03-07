import type { GatewayChannelType } from './channel-router.js';
import type {
  GatewayChannelAdapter,
  GatewayChannelAdapterStatus,
} from './channel-adapter.js';
import type { GatewayChannelAdapterConfig, GatewayChannelAdapterConfigMap } from './channel-adapter-config.js';
import { normalizeAdapterConfig, sanitizeAdapterConfig, resolveAdapterRetryPolicy } from './channel-adapter-config.js';

type AdapterTransitionReason = 'startup' | 'rpc-update' | 'channel-toggle' | 'shutdown';
type AdapterTransitionSource = 'gateway-startup' | 'rpc-system.channels.update' | 'channel-router' | 'gateway-stop';

interface AdapterRetryAttempt {
  timestamp: number;
  attempt: number;
  phase: 'start';
  outcome: 'success' | 'failure';
  reason: AdapterTransitionReason;
  source: AdapterTransitionSource;
  error?: string;
}

interface AdapterTransitionMeta {
  lastTransitionReason?: AdapterTransitionReason;
  lastTransitionSource?: AdapterTransitionSource;
  retryTrail: AdapterRetryAttempt[];
}

export interface ChannelAdapterPublishReport {
  attempted: number;
  delivered: number;
  failed: Array<{ channel: GatewayChannelType; error: string }>;
}

export class ChannelAdapterManager {
  private adapters = new Map<GatewayChannelType, GatewayChannelAdapter>();
  private transitionMeta = new Map<GatewayChannelType, AdapterTransitionMeta>();

  constructor(adapters: GatewayChannelAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.channel, adapter);
      this.transitionMeta.set(adapter.channel, { retryTrail: [] });
    }
  }

  async applyConfig(configs: GatewayChannelAdapterConfigMap): Promise<void> {
    for (const [channel, config] of Object.entries(configs)) {
      const adapter = this.adapters.get(channel as GatewayChannelType);
      if (!adapter) {
        continue;
      }
      const normalized = normalizeAdapterConfig(channel as GatewayChannelType, config ?? {});
      await adapter.configure(normalized as GatewayChannelAdapterConfig);
    }
  }

  getConfig(): GatewayChannelAdapterConfigMap {
    const result: GatewayChannelAdapterConfigMap = {};
    for (const [channel, adapter] of this.adapters.entries()) {
      result[channel] = adapter.getStatus().config;
    }

    return result;
  }

  async applyEnabledChannels(
    channels: GatewayChannelType[],
    context: {
      reason: AdapterTransitionReason;
      source: AdapterTransitionSource;
    }
  ): Promise<void> {
    const enabled = new Set(channels);

    for (const [channel, adapter] of this.adapters.entries()) {
      if (enabled.has(channel)) {
        await this.startWithRetry(channel, adapter, context);
      } else {
        await adapter.stop();
        this.setTransitionMeta(channel, context);
      }
    }
  }

  async stopAll(context: { reason: AdapterTransitionReason; source: AdapterTransitionSource }): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
      this.setTransitionMeta(adapter.channel, context);
    }
  }

  getStatuses(): GatewayChannelAdapterStatus[] {
    return Array.from(this.adapters.values()).map((adapter) => {
      const status = adapter.getStatus();
      return {
        ...status,
        config: sanitizeAdapterConfig(status.channel, status.config),
        ...(this.transitionMeta.get(status.channel)?.lastTransitionReason
          ? { lastTransitionReason: this.transitionMeta.get(status.channel)?.lastTransitionReason }
          : {}),
        ...(this.transitionMeta.get(status.channel)?.lastTransitionSource
          ? { lastTransitionSource: this.transitionMeta.get(status.channel)?.lastTransitionSource }
          : {}),
        retryTrail: [...(this.transitionMeta.get(status.channel)?.retryTrail ?? [])],
      };
    });
  }

  async publishToChannels(
    channels: GatewayChannelType[],
    event: string,
    payload: Record<string, unknown>
  ): Promise<ChannelAdapterPublishReport> {
    const report: ChannelAdapterPublishReport = {
      attempted: 0,
      delivered: 0,
      failed: [],
    };

    for (const channel of new Set(channels)) {
      if (channel === 'tui') {
        continue;
      }

      const adapter = this.adapters.get(channel);
      if (!adapter) {
        continue;
      }

      report.attempted += 1;
      try {
        await adapter.publish(event, payload);
        report.delivered += 1;
      } catch (error) {
        report.failed.push({
          channel,
          error: (error as Error).message,
        });
      }
    }

    return report;
  }

  private async startWithRetry(
    channel: GatewayChannelType,
    adapter: GatewayChannelAdapter,
    context: { reason: AdapterTransitionReason; source: AdapterTransitionSource }
  ): Promise<void> {
    const policy = resolveAdapterRetryPolicy(adapter.getStatus().config);
    const maxAttempts = policy.attempts;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await adapter.start();
        this.pushRetryAttempt(channel, {
          timestamp: Date.now(),
          attempt,
          phase: 'start',
          outcome: 'success',
          reason: context.reason,
          source: context.source,
        });
        this.setTransitionMeta(channel, context);
        return;
      } catch (error) {
        lastError = error as Error;
        this.pushRetryAttempt(channel, {
          timestamp: Date.now(),
          attempt,
          phase: 'start',
          outcome: 'failure',
          reason: context.reason,
          source: context.source,
          error: lastError.message,
        });

        if (attempt < maxAttempts && policy.backoffMs > 0) {
          await this.sleep(policy.backoffMs);
        }
      }
    }

    this.setTransitionMeta(channel, context);
    if (lastError) {
      throw lastError;
    }
  }

  private setTransitionMeta(
    channel: GatewayChannelType,
    context: { reason: AdapterTransitionReason; source: AdapterTransitionSource }
  ): void {
    const existing = this.transitionMeta.get(channel) ?? { retryTrail: [] };
    this.transitionMeta.set(channel, {
      ...existing,
      lastTransitionReason: context.reason,
      lastTransitionSource: context.source,
    });
  }

  private pushRetryAttempt(channel: GatewayChannelType, attempt: AdapterRetryAttempt): void {
    const existing = this.transitionMeta.get(channel) ?? { retryTrail: [] };
    const nextTrail = [...existing.retryTrail, attempt];
    this.transitionMeta.set(channel, {
      ...existing,
      retryTrail: nextTrail.slice(-20),
    });
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
