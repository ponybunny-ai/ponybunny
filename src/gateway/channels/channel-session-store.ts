import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

import type { GatewayChannelType } from './channel-router.js';

type SessionChannelMap = Record<string, GatewayChannelType>;

const VALID_CHANNELS: GatewayChannelType[] = ['tui', 'webui', 'email', 'telegram', 'whatsapp', 'discord'];

function isChannelType(value: unknown): value is GatewayChannelType {
  return typeof value === 'string' && VALID_CHANNELS.includes(value as GatewayChannelType);
}

export class ChannelSessionStore {
  constructor(private filePath: string) {}

  load(): SessionChannelMap {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null) {
        return {};
      }

      const map: SessionChannelMap = {};
      for (const [sessionId, channel] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof sessionId === 'string' && sessionId.length > 0 && isChannelType(channel)) {
          map[sessionId] = channel;
        }
      }
      return map;
    } catch {
      return {};
    }
  }

  save(map: SessionChannelMap): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(map, null, 2), 'utf-8');
  }
}
