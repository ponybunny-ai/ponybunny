import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

import type { GatewayChannelType } from './channel-router.js';

export interface StoredChannelEvent {
  id: string;
  event: string;
  timestamp: number;
  channelType?: GatewayChannelType;
  channelSessionId?: string;
  sessionId?: string;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  payload: Record<string, unknown>;
}

interface PersistedChannelEvents {
  events: StoredChannelEvent[];
}

const VALID_CHANNELS: GatewayChannelType[] = ['tui', 'webui', 'email', 'telegram', 'whatsapp', 'discord'];

function isGatewayChannelType(value: unknown): value is GatewayChannelType {
  return typeof value === 'string' && VALID_CHANNELS.includes(value as GatewayChannelType);
}

export class ChannelEventStore {
  constructor(private filePath: string, private maxEvents = 2000) {}

  load(): StoredChannelEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedChannelEvents;
      if (!parsed || !Array.isArray(parsed.events)) {
        return [];
      }

      return parsed.events.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        if (typeof item.id !== 'string' || item.id.length === 0) return false;
        if (typeof item.event !== 'string' || item.event.length === 0) return false;
        if (typeof item.timestamp !== 'number') return false;
        if (item.channelType !== undefined && !isGatewayChannelType(item.channelType)) return false;
        return typeof item.payload === 'object' && item.payload !== null;
      });
    } catch {
      return [];
    }
  }

  save(events: StoredChannelEvent[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const trimmed = events.slice(-this.maxEvents);
    const payload: PersistedChannelEvents = { events: trimmed };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }
}
