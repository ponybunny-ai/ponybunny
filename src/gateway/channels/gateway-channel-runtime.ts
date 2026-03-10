import { join } from 'path';

import type { EventBus } from '../events/event-bus.js';
import {
  ChannelAdapterManager,
  type ChannelAdapterPublishReport,
} from './channel-adapter-manager.js';
import {
  ChannelRouter,
  type GatewayChannelType,
} from './channel-router.js';
import { ChannelSessionStore } from './channel-session-store.js';
import {
  ChannelEventStore,
  type StoredChannelEvent,
} from './channel-event-store.js';
import { ChannelEventEnricher } from './channel-event-enricher.js';
import {
  ChannelAdapterConfigStore,
} from './channel-adapter-config-store.js';
import {
  DiscordChannelAdapter,
  EmailChannelAdapter,
  TelegramChannelAdapter,
  WebuiChannelAdapter,
  WhatsappChannelAdapter,
  type GatewayChannelAdapterStatus,
} from './channel-adapter.js';
import {
  type GatewayChannelAdapterConfig,
  type GatewayChannelAdapterConfigMap,
  diffAdapterConfigMaps,
  normalizeAdapterConfig,
  sanitizeAdapterConfigMap,
  summarizeAdapterConfigImpact,
} from './channel-adapter-config.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';

const CHANNEL_EVENT_PREFIXES = [
  'conversation.',
  'goal.',
  'workitem.',
  'run.',
  'verification.',
  'escalation.',
  'budget.',
  'channel.adapter.',
] as const;

const ADAPTER_DELIVERY_EVENTS = new Set<string>([
  'conversation.response',
  'goal.completed',
  'goal.failed',
  'run.completed',
  'verification.completed',
  'escalation.created',
  'escalation.resolved',
]);

interface GatewayChannelRuntimeServices {
  channelRouter: ChannelRouter;
  channelAdapterManager: ChannelAdapterManager;
  channelSessionStore: ChannelSessionStore;
  channelEventStore: ChannelEventStore;
  channelEventEnricher: ChannelEventEnricher;
  channelAdapterConfigStore: ChannelAdapterConfigStore;
}

export interface GatewayChannelRuntimeConfig {
  repository: IWorkOrderRepository;
  eventBus: EventBus;
  configDir: string;
}

export interface GatewayChannelRuntimeUpdateOptions {
  enabledChannels?: GatewayChannelType[];
  mirrorToAllEnabledChannels?: boolean;
  sessionChannelOverrides?: Array<{ sessionId: string; channel: GatewayChannelType }>;
  clearSessionChannelOverrides?: string[];
}

export class GatewayChannelRuntime {
  readonly channelRouter: ChannelRouter;
  readonly channelAdapterManager: ChannelAdapterManager;

  private readonly eventBus: EventBus;
  private readonly channelSessionStore: ChannelSessionStore;
  private readonly channelEventStore: ChannelEventStore;
  private readonly channelEventEnricher: ChannelEventEnricher;
  private readonly channelAdapterConfigStore: ChannelAdapterConfigStore;
  private channelAdapterConfigs: GatewayChannelAdapterConfigMap;
  private storedChannelEvents: StoredChannelEvent[];

  constructor(
    eventBus: EventBus,
    services: GatewayChannelRuntimeServices,
    initialState?: {
      channelAdapterConfigs?: GatewayChannelAdapterConfigMap;
      storedChannelEvents?: StoredChannelEvent[];
    }
  ) {
    this.eventBus = eventBus;
    this.channelRouter = services.channelRouter;
    this.channelAdapterManager = services.channelAdapterManager;
    this.channelSessionStore = services.channelSessionStore;
    this.channelEventStore = services.channelEventStore;
    this.channelEventEnricher = services.channelEventEnricher;
    this.channelAdapterConfigStore = services.channelAdapterConfigStore;
    this.channelAdapterConfigs = initialState?.channelAdapterConfigs ?? {};
    this.storedChannelEvents = initialState?.storedChannelEvents ?? [];
  }

  static createDefault(config: GatewayChannelRuntimeConfig): GatewayChannelRuntime {
    const channelRouter = new ChannelRouter();
    const channelAdapterManager = new ChannelAdapterManager([
      new WebuiChannelAdapter(),
      new EmailChannelAdapter(),
      new TelegramChannelAdapter(),
      new WhatsappChannelAdapter(),
      new DiscordChannelAdapter(),
    ]);
    const channelAdapterConfigStore = new ChannelAdapterConfigStore(
      join(config.configDir, 'gateway', 'channel-adapter-configs.json')
    );
    const channelSessionStore = new ChannelSessionStore(
      join(config.configDir, 'gateway', 'channel-sessions.json')
    );
    const channelEventStore = new ChannelEventStore(
      join(config.configDir, 'gateway', 'channel-events.json')
    );
    const runtime = new GatewayChannelRuntime(
      config.eventBus,
      {
        channelRouter,
        channelAdapterManager,
        channelSessionStore,
        channelEventStore,
        channelEventEnricher: new ChannelEventEnricher(config.repository),
        channelAdapterConfigStore,
      },
      {
        channelAdapterConfigs: channelAdapterConfigStore.load(),
        storedChannelEvents: channelEventStore.load(),
      }
    );

    runtime.channelRouter.setSessionChannelOverrides(runtime.channelSessionStore.load());
    return runtime;
  }

  getStoredEvents(): StoredChannelEvent[] {
    return this.storedChannelEvents;
  }

  getAdapterStatuses(): GatewayChannelAdapterStatus[] {
    return this.channelAdapterManager.getStatuses();
  }

  getAdapterConfigs(): GatewayChannelAdapterConfigMap {
    return { ...this.channelAdapterConfigs };
  }

  applyChannelRoutingUpdate(options: GatewayChannelRuntimeUpdateOptions): void {
    if (Array.isArray(options.enabledChannels)) {
      this.channelRouter.setEnabledChannels(options.enabledChannels);
    }

    if (typeof options.mirrorToAllEnabledChannels === 'boolean') {
      this.channelRouter.setMirrorToAllEnabledChannels(options.mirrorToAllEnabledChannels);
    }

    if (Array.isArray(options.sessionChannelOverrides)) {
      for (const override of options.sessionChannelOverrides) {
        if (override && typeof override.sessionId === 'string') {
          this.channelRouter.setSessionChannel(override.sessionId, override.channel);
        }
      }
    }

    if (Array.isArray(options.clearSessionChannelOverrides)) {
      for (const sessionId of options.clearSessionChannelOverrides) {
        if (typeof sessionId === 'string' && sessionId.length > 0) {
          this.channelRouter.clearSessionChannel(sessionId);
        }
      }
    }
  }

  handleConnectionAuthenticated(sample: unknown): void {
    if (!sample || typeof sample !== 'object') {
      return;
    }

    const payload = sample as {
      sessionId?: string;
      metadata?: Record<string, unknown>;
    };

    if (typeof payload.sessionId !== 'string') {
      return;
    }

    const metadata = payload.metadata;
    if (!metadata || typeof metadata.channelType !== 'string') {
      return;
    }

    const channelType = metadata.channelType;
    if (
      channelType === 'tui'
      || channelType === 'webui'
      || channelType === 'email'
      || channelType === 'telegram'
      || channelType === 'whatsapp'
      || channelType === 'discord'
    ) {
      this.channelRouter.setSessionChannel(payload.sessionId, channelType);
      this.channelSessionStore.save(this.channelRouter.getSessionChannelOverrides());
    }
  }

  handleConnectionDisconnected(sample: unknown): void {
    if (!sample || typeof sample !== 'object') {
      return;
    }

    const payload = sample as {
      sessionId?: string;
    };

    if (typeof payload.sessionId === 'string') {
      this.channelRouter.clearSessionChannel(payload.sessionId);
      this.channelSessionStore.save(this.channelRouter.getSessionChannelOverrides());
    }
  }

  async updateAdapterConfigs(configs: GatewayChannelAdapterConfigMap): Promise<void> {
    const previousConfigs = { ...this.channelAdapterConfigs };
    const mergedConfigs: GatewayChannelAdapterConfigMap = {
      ...this.channelAdapterConfigs,
    };

    for (const [channel, config] of Object.entries(configs)) {
      const typedChannel = channel as GatewayChannelType;
      const previous = mergedConfigs[typedChannel] ?? {};
      mergedConfigs[typedChannel] = normalizeAdapterConfig(typedChannel, {
        ...(previous as GatewayChannelAdapterConfig),
        ...((config ?? {}) as GatewayChannelAdapterConfig),
      });
    }

    await this.channelAdapterManager.applyConfig(mergedConfigs);
    this.channelAdapterConfigs = mergedConfigs;
    this.channelAdapterConfigStore.save(this.channelAdapterConfigs);

    const sanitizedBefore = sanitizeAdapterConfigMap(previousConfigs);
    const sanitizedAfter = sanitizeAdapterConfigMap(this.channelAdapterConfigs);
    const diff = diffAdapterConfigMaps(sanitizedBefore, sanitizedAfter);
    const impactSummary = summarizeAdapterConfigImpact(diff);
    this.eventBus.emit('channel.adapter.config.updated', {
      timestamp: Date.now(),
      reason: 'rpc-update',
      source: 'rpc-system.channels.update',
      configs: sanitizedAfter,
      diff,
      impactSummary,
    });
    this.eventBus.emit('channel.adapter.status.updated', {
      timestamp: Date.now(),
      reason: 'rpc-update',
      source: 'rpc-system.channels.update',
      adapters: this.channelAdapterManager.getStatuses(),
    });
  }

  async applyEnabledChannels(reason: 'startup' | 'channel-toggle', source: 'gateway-startup' | 'channel-router'): Promise<void> {
    await this.channelAdapterManager.applyEnabledChannels(this.channelRouter.getEnabledChannels(), {
      reason,
      source,
    });
    this.eventBus.emit('channel.adapter.status.updated', {
      timestamp: Date.now(),
      reason,
      source,
      adapters: this.channelAdapterManager.getStatuses(),
    });
  }

  async captureEvent(event: string, sample: unknown): Promise<ChannelAdapterPublishReport | null> {
    if (!this.shouldStoreChannelEvent(event)) {
      return null;
    }
    if (!sample || typeof sample !== 'object') {
      return null;
    }

    const payload = sample as Record<string, unknown>;
    const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
    const goalId = typeof payload.goalId === 'string' ? payload.goalId : undefined;
    const workItemId = typeof payload.workItemId === 'string' ? payload.workItemId : undefined;
    const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
    const goalContext = this.channelEventEnricher.resolveFromDomainIds(goalId, workItemId, runId);
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : goalContext.sessionId;
    const channelSessionId = typeof payload.channelSessionId === 'string'
      ? payload.channelSessionId
      : goalContext.channelSessionId;
    const gatewaySessionId = typeof payload.gatewaySessionId === 'string' ? payload.gatewaySessionId : undefined;
    const metadata = payload.metadata;
    const metadataChannelType = (
      metadata
      && typeof metadata === 'object'
      && typeof (metadata as Record<string, unknown>).channelType === 'string'
    )
      ? (metadata as Record<string, unknown>).channelType
      : undefined;
    const channelType = this.resolveChannelType(
      payload,
      gatewaySessionId,
      sessionId,
      metadataChannelType,
      goalContext.channelType
    );

    this.storedChannelEvents.push({
      id: `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
      event,
      timestamp,
      channelType,
      channelSessionId,
      sessionId,
      goalId,
      workItemId,
      runId,
      payload,
    });

    if (this.storedChannelEvents.length > 2000) {
      this.storedChannelEvents = this.storedChannelEvents.slice(-2000);
    }

    this.channelEventStore.save(this.storedChannelEvents);

    if (!ADAPTER_DELIVERY_EVENTS.has(event)) {
      return null;
    }

    const channels = this.resolveAdapterDeliveryChannels(channelType);
    if (channels.length === 0) {
      return null;
    }

    return this.channelAdapterManager.publishToChannels(channels, event, payload);
  }

  private shouldStoreChannelEvent(event: string): boolean {
    for (const prefix of CHANNEL_EVENT_PREFIXES) {
      if (event.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  private resolveChannelType(
    payload: Record<string, unknown>,
    gatewaySessionId?: string,
    sessionId?: string,
    metadataChannelType?: unknown,
    goalContextChannelType?: StoredChannelEvent['channelType']
  ): StoredChannelEvent['channelType'] {
    const overrides = this.channelRouter.getSessionChannelOverrides();
    const overrideChannelByGatewaySession = gatewaySessionId ? overrides[gatewaySessionId] : undefined;
    const overrideChannelBySession = sessionId ? overrides[sessionId] : undefined;
    const rawChannelType = typeof payload.channelType === 'string'
      ? payload.channelType
      : typeof metadataChannelType === 'string'
        ? metadataChannelType
        : goalContextChannelType ?? overrideChannelByGatewaySession ?? overrideChannelBySession;

    if (
      rawChannelType === 'tui'
      || rawChannelType === 'webui'
      || rawChannelType === 'email'
      || rawChannelType === 'telegram'
      || rawChannelType === 'whatsapp'
      || rawChannelType === 'discord'
    ) {
      return rawChannelType;
    }

    return undefined;
  }

  private resolveAdapterDeliveryChannels(sourceChannelType?: GatewayChannelType): GatewayChannelType[] {
    const enabledChannels = this.channelRouter
      .getEnabledChannels()
      .filter((channel): channel is Exclude<GatewayChannelType, 'tui'> => channel !== 'tui');
    if (enabledChannels.length === 0) {
      return [];
    }

    if (this.channelRouter.getMirrorToAllEnabledChannels()) {
      return enabledChannels;
    }

    if (sourceChannelType && sourceChannelType !== 'tui' && enabledChannels.includes(sourceChannelType)) {
      return [sourceChannelType];
    }

    return [];
  }
}
