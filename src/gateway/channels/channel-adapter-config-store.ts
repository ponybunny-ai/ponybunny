import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

import type { GatewayChannelType } from './channel-router.js';
import type { GatewayChannelAdapterConfigMap } from './channel-adapter-config.js';
import { normalizeAdapterConfigMap } from './channel-adapter-config.js';

const VALID_CHANNELS: GatewayChannelType[] = ['tui', 'webui', 'email', 'telegram', 'whatsapp', 'discord'];
const ADAPTER_CONFIG_STORE_VERSION = 1;

interface PersistedAdapterConfigEnvelope {
  version: number;
  configs: GatewayChannelAdapterConfigMap;
}

function parseAdapterConfigMap(value: unknown): GatewayChannelAdapterConfigMap {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const map: GatewayChannelAdapterConfigMap = {};
  for (const [channel, config] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_CHANNELS.includes(channel as GatewayChannelType)) {
      continue;
    }
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      map[channel as GatewayChannelType] = config as Record<string, unknown>;
    }
  }

  return map;
}

export class ChannelAdapterConfigStore {
  constructor(private filePath: string) {}

  load(): GatewayChannelAdapterConfigMap {
    if (!existsSync(this.filePath)) {
      return {};
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      const envelope = parsed as Partial<PersistedAdapterConfigEnvelope>;
      if (typeof envelope.version === 'number' && envelope.version >= 1 && envelope.configs !== undefined) {
        return normalizeAdapterConfigMap(parseAdapterConfigMap(envelope.configs));
      }

      return normalizeAdapterConfigMap(parseAdapterConfigMap(parsed));
    } catch {
      return {};
    }
  }

  save(map: GatewayChannelAdapterConfigMap): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const envelope: PersistedAdapterConfigEnvelope = {
      version: ADAPTER_CONFIG_STORE_VERSION,
      configs: normalizeAdapterConfigMap(map),
    };
    writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), 'utf-8');
  }
}
