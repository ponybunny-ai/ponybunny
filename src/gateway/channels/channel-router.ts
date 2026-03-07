import type { Session } from '../connection/session.js';

export type GatewayChannelType = 'tui' | 'webui' | 'email' | 'telegram' | 'whatsapp' | 'discord';

interface ChannelBroadcastPolicy {
  enabledChannels: GatewayChannelType[];
  mirrorToAllEnabledChannels: boolean;
  sourceChannel?: GatewayChannelType;
}

export class ChannelRouter {
  private enabledChannels = new Set<GatewayChannelType>(['tui']);
  private mirrorToAllEnabledChannels = true;
  private sessionChannelOverrides = new Map<string, GatewayChannelType>();

  setEnabledChannels(channels: GatewayChannelType[]): void {
    this.enabledChannels = new Set(channels.length > 0 ? channels : ['tui']);
  }

  getEnabledChannels(): GatewayChannelType[] {
    return Array.from(this.enabledChannels);
  }

  setMirrorToAllEnabledChannels(enabled: boolean): void {
    this.mirrorToAllEnabledChannels = enabled;
  }

  getMirrorToAllEnabledChannels(): boolean {
    return this.mirrorToAllEnabledChannels;
  }

  setSessionChannel(sessionId: string, channel: GatewayChannelType): void {
    if (!this.enabledChannels.has(channel)) {
      this.enabledChannels.add(channel);
    }
    this.sessionChannelOverrides.set(sessionId, channel);
  }

  clearSessionChannel(sessionId: string): void {
    this.sessionChannelOverrides.delete(sessionId);
  }

  getSessionChannelOverrides(): Record<string, GatewayChannelType> {
    return Object.fromEntries(this.sessionChannelOverrides.entries());
  }

  setSessionChannelOverrides(overrides: Record<string, GatewayChannelType>): void {
    this.sessionChannelOverrides.clear();
    for (const [sessionId, channel] of Object.entries(overrides)) {
      this.setSessionChannel(sessionId, channel);
    }
  }

  buildSessionFilter(data: unknown): (session: Session) => boolean {
    const policy = this.resolvePolicy(data);
    return (session: Session) => {
      const channel = this.getSessionChannel(session);
      if (!policy.enabledChannels.includes(channel)) {
        return false;
      }
      if (policy.mirrorToAllEnabledChannels) {
        return true;
      }
      if (!policy.sourceChannel) {
        return true;
      }
      return channel === policy.sourceChannel;
    };
  }

  private resolvePolicy(data: unknown): ChannelBroadcastPolicy {
    const defaultChannels = Array.from(this.enabledChannels);
    if (typeof data !== 'object' || data === null) {
      return {
        enabledChannels: defaultChannels,
        mirrorToAllEnabledChannels: this.mirrorToAllEnabledChannels,
      };
    }

    const obj = data as Record<string, unknown>;
    const sourceChannel = this.toChannelType(obj.channelType) ?? this.toChannelType(obj.channel);
    const mirror =
      typeof obj.mirrorToAllEnabledChannels === 'boolean'
        ? obj.mirrorToAllEnabledChannels
        : this.mirrorToAllEnabledChannels;
    const explicit = Array.isArray(obj.enabledChannels)
      ? obj.enabledChannels.map((value) => this.toChannelType(value)).filter((value): value is GatewayChannelType => value !== undefined)
      : [];

    const enabledChannels = explicit.length > 0 ? explicit : defaultChannels;
    return {
      enabledChannels,
      mirrorToAllEnabledChannels: mirror,
      sourceChannel,
    };
  }

  private getSessionChannel(session: Session): GatewayChannelType {
    const override = this.sessionChannelOverrides.get(session.id);
    if (override) {
      return override;
    }

    const metadata = session.metadata;
    if (metadata && typeof metadata.channelType === 'string') {
      const parsed = this.toChannelType(metadata.channelType);
      if (parsed) return parsed;
    }
    return 'tui';
  }

  private toChannelType(value: unknown): GatewayChannelType | undefined {
    if (typeof value !== 'string') return undefined;
    if (value === 'tui') return 'tui';
    if (value === 'webui') return 'webui';
    if (value === 'email') return 'email';
    if (value === 'telegram') return 'telegram';
    if (value === 'whatsapp') return 'whatsapp';
    if (value === 'discord') return 'discord';
    return undefined;
  }
}
