import type { GatewayChannelType } from './channel-router.js';
import type { GatewayChannelAdapterConfig } from './channel-adapter-config.js';

export type GatewayChannelAdapterState = 'stopped' | 'running' | 'error';

export interface GatewayChannelAdapterStatus {
  channel: GatewayChannelType;
  state: GatewayChannelAdapterState;
  available: boolean;
  config: GatewayChannelAdapterConfig;
  startCount: number;
  stopCount: number;
  errorCount: number;
  configUpdatedAt?: number;
  lastStateChangedAt?: number;
  deliveryCount: number;
  deliveryErrorCount: number;
  lastDeliveryAt?: number;
  lastDeliveryError?: string;
  lastTransitionReason?: 'startup' | 'rpc-update' | 'channel-toggle' | 'shutdown';
  lastTransitionSource?: 'gateway-startup' | 'rpc-system.channels.update' | 'channel-router' | 'gateway-stop';
  retryTrail?: Array<{
    timestamp: number;
    attempt: number;
    phase: 'start';
    outcome: 'success' | 'failure';
    reason: 'startup' | 'rpc-update' | 'channel-toggle' | 'shutdown';
    source: 'gateway-startup' | 'rpc-system.channels.update' | 'channel-router' | 'gateway-stop';
    error?: string;
  }>;
  lastStartedAt?: number;
  lastStoppedAt?: number;
  lastError?: string;
}

export interface GatewayChannelAdapter {
  readonly channel: GatewayChannelType;
  configure(config: GatewayChannelAdapterConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(event: string, payload: Record<string, unknown>): Promise<void>;
  getStatus(): GatewayChannelAdapterStatus;
}

abstract class BaseGatewayChannelAdapter implements GatewayChannelAdapter {
  private state: GatewayChannelAdapterState = 'stopped';
  private config: GatewayChannelAdapterConfig = {};
  private startCount = 0;
  private stopCount = 0;
  private errorCount = 0;
  private deliveryCount = 0;
  private deliveryErrorCount = 0;
  private configUpdatedAt?: number;
  private lastStateChangedAt?: number;
  private lastDeliveryAt?: number;
  private lastDeliveryError?: string;
  private lastStartedAt?: number;
  private lastStoppedAt?: number;
  private lastError?: string;

  constructor(
    public readonly channel: GatewayChannelType,
    private readonly available: boolean
  ) {}

  async configure(config: GatewayChannelAdapterConfig): Promise<void> {
    this.config = { ...config };
    this.configUpdatedAt = Date.now();
    await this.onConfigure(this.config);
  }

  async start(): Promise<void> {
    if (this.state === 'running') {
      return;
    }

    try {
      await this.onStart();
      this.state = 'running';
      this.lastError = undefined;
      this.lastStartedAt = Date.now();
      this.lastStateChangedAt = this.lastStartedAt;
      this.startCount += 1;
    } catch (error) {
      this.state = 'error';
      this.lastError = (error as Error).message;
      this.lastStateChangedAt = Date.now();
      this.errorCount += 1;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    try {
      await this.onStop();
    } finally {
      this.state = 'stopped';
      this.lastStoppedAt = Date.now();
      this.lastStateChangedAt = this.lastStoppedAt;
      this.stopCount += 1;
    }
  }

  async publish(event: string, payload: Record<string, unknown>): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    try {
      await this.onPublish(event, payload);
      this.deliveryCount += 1;
      this.lastDeliveryAt = Date.now();
      this.lastDeliveryError = undefined;
    } catch (error) {
      this.deliveryErrorCount += 1;
      this.lastDeliveryError = (error as Error).message;
      throw error;
    }
  }

  getStatus(): GatewayChannelAdapterStatus {
    return {
      channel: this.channel,
      state: this.state,
      available: this.available,
      config: { ...this.config },
      startCount: this.startCount,
      stopCount: this.stopCount,
      errorCount: this.errorCount,
      deliveryCount: this.deliveryCount,
      deliveryErrorCount: this.deliveryErrorCount,
      ...(this.configUpdatedAt ? { configUpdatedAt: this.configUpdatedAt } : {}),
      ...(this.lastStateChangedAt ? { lastStateChangedAt: this.lastStateChangedAt } : {}),
      ...(this.lastDeliveryAt ? { lastDeliveryAt: this.lastDeliveryAt } : {}),
      ...(this.lastDeliveryError ? { lastDeliveryError: this.lastDeliveryError } : {}),
      ...(this.lastStartedAt ? { lastStartedAt: this.lastStartedAt } : {}),
      ...(this.lastStoppedAt ? { lastStoppedAt: this.lastStoppedAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  protected async onConfigure(_config: GatewayChannelAdapterConfig): Promise<void> {
    return;
  }

  protected async onPublish(_event: string, _payload: Record<string, unknown>): Promise<void> {
    return;
  }

  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
}

export class WebuiChannelAdapter extends BaseGatewayChannelAdapter {
  constructor() {
    super('webui', true);
  }

  protected async onStart(): Promise<void> {
    return;
  }

  protected async onStop(): Promise<void> {
    return;
  }
}

export class DiscordChannelAdapter extends BaseGatewayChannelAdapter {
  private webhookUrl = '';

  constructor() {
    super('discord', true);
  }

  protected async onConfigure(config: GatewayChannelAdapterConfig): Promise<void> {
    this.webhookUrl = typeof config.webhookUrl === 'string' ? config.webhookUrl : '';
  }

  protected async onStart(): Promise<void> {
    return;
  }

  protected async onStop(): Promise<void> {
    return;
  }

  protected async onPublish(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    const goalId = typeof payload.goalId === 'string' ? payload.goalId : undefined;
    const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
    const summary = [
      `event=${event}`,
      ...(goalId ? [`goal=${goalId}`] : []),
      ...(runId ? [`run=${runId}`] : []),
    ].join(' | ');

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `[PonyBunny] ${summary}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`discord webhook publish failed: ${response.status}`);
    }
  }
}

export class EmailChannelAdapter extends BaseGatewayChannelAdapter {
  constructor() {
    super('email', true);
  }

  protected async onStart(): Promise<void> {
    return;
  }

  protected async onStop(): Promise<void> {
    return;
  }
}

export class TelegramChannelAdapter extends BaseGatewayChannelAdapter {
  constructor() {
    super('telegram', true);
  }

  protected async onStart(): Promise<void> {
    return;
  }

  protected async onStop(): Promise<void> {
    return;
  }
}

export class WhatsappChannelAdapter extends BaseGatewayChannelAdapter {
  constructor() {
    super('whatsapp', true);
  }

  protected async onStart(): Promise<void> {
    return;
  }

  protected async onStop(): Promise<void> {
    return;
  }
}
