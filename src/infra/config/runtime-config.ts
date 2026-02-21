import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { getConfigDir } from './config-paths.js';

export interface PonyBunnyRuntimeConfig {
  $schema?: string;
  paths: {
    database: string;
    schedulerSocket: string;
  };
  gateway: {
    host: string;
    port: number;
  };
  scheduler: {
    tickIntervalMs: number;
    maxConcurrentGoals: number;
    agentsEnabled: boolean;
  };
  debug: {
    serverPort: number;
    loggingEnabled: boolean;
    antigravityDebug: boolean;
  };
}

const PONY_DIR = path.join(homedir(), '.ponybunny');

export const DEFAULT_RUNTIME_CONFIG: PonyBunnyRuntimeConfig = {
  $schema: './ponybunny.schema.json',
  paths: {
    database: path.join(PONY_DIR, 'pony.db'),
    schedulerSocket: path.join(PONY_DIR, 'gateway.sock'),
  },
  gateway: {
    host: '127.0.0.1',
    port: 18789,
  },
  scheduler: {
    tickIntervalMs: 1000,
    maxConcurrentGoals: 5,
    agentsEnabled: false,
  },
  debug: {
    serverPort: 3001,
    loggingEnabled: false,
    antigravityDebug: false,
  },
};

export function getRuntimeConfigPath(): string {
  return path.join(getConfigDir(), 'ponybunny.json');
}

export function getRuntimeSchemaPath(): string {
  return path.join(getConfigDir(), 'ponybunny.schema.json');
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }

  return fallback;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function resolveRuntimeConfigFromEnvironment(
  env: NodeJS.ProcessEnv = process.env
): PonyBunnyRuntimeConfig {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    paths: {
      database: toStringValue(env.PONY_DB_PATH, DEFAULT_RUNTIME_CONFIG.paths.database),
      schedulerSocket: toStringValue(env.PONY_SCHEDULER_SOCKET, DEFAULT_RUNTIME_CONFIG.paths.schedulerSocket),
    },
    gateway: {
      host: toStringValue(env.PONY_GATEWAY_HOST, DEFAULT_RUNTIME_CONFIG.gateway.host),
      port: toPositiveInt(env.PONY_GATEWAY_PORT, DEFAULT_RUNTIME_CONFIG.gateway.port),
    },
    scheduler: {
      tickIntervalMs: toPositiveInt(env.PONY_SCHEDULER_TICK_MS, DEFAULT_RUNTIME_CONFIG.scheduler.tickIntervalMs),
      maxConcurrentGoals: toPositiveInt(
        env.PONY_SCHEDULER_MAX_CONCURRENT_GOALS,
        DEFAULT_RUNTIME_CONFIG.scheduler.maxConcurrentGoals
      ),
      agentsEnabled: toBoolean(env.PONY_SCHEDULER_AGENTS_ENABLED, DEFAULT_RUNTIME_CONFIG.scheduler.agentsEnabled),
    },
    debug: {
      serverPort: toPositiveInt(env.DEBUG_SERVER_PORT, DEFAULT_RUNTIME_CONFIG.debug.serverPort),
      loggingEnabled: env.PONY_BUNNY_DEBUG === '1',
      antigravityDebug: env.PB_ANTIGRAVITY_DEBUG === '1',
    },
  };
}

function deepMerge<T extends Record<string, unknown>>(base: T, value: unknown): T {
  if (typeof value !== 'object' || value === null) {
    return { ...base };
  }

  const source = value as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base };

  for (const key of Object.keys(source)) {
    const baseValue = merged[key];
    const sourceValue = source[key];

    if (
      typeof baseValue === 'object' &&
      baseValue !== null &&
      !Array.isArray(baseValue) &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue)
    ) {
      merged[key] = deepMerge(baseValue as Record<string, unknown>, sourceValue);
    } else {
      merged[key] = sourceValue;
    }
  }

  return merged as T;
}

function normalizeConfig(raw: PonyBunnyRuntimeConfig): PonyBunnyRuntimeConfig {
  return {
    $schema: './ponybunny.schema.json',
    paths: {
      database: path.resolve(toStringValue(raw.paths?.database, DEFAULT_RUNTIME_CONFIG.paths.database)),
      schedulerSocket: path.resolve(
        toStringValue(raw.paths?.schedulerSocket, DEFAULT_RUNTIME_CONFIG.paths.schedulerSocket)
      ),
    },
    gateway: {
      host: toStringValue(raw.gateway?.host, DEFAULT_RUNTIME_CONFIG.gateway.host),
      port: toPositiveInt(raw.gateway?.port, DEFAULT_RUNTIME_CONFIG.gateway.port),
    },
    scheduler: {
      tickIntervalMs: toPositiveInt(raw.scheduler?.tickIntervalMs, DEFAULT_RUNTIME_CONFIG.scheduler.tickIntervalMs),
      maxConcurrentGoals: toPositiveInt(
        raw.scheduler?.maxConcurrentGoals,
        DEFAULT_RUNTIME_CONFIG.scheduler.maxConcurrentGoals
      ),
      agentsEnabled: toBoolean(raw.scheduler?.agentsEnabled, DEFAULT_RUNTIME_CONFIG.scheduler.agentsEnabled),
    },
    debug: {
      serverPort: toPositiveInt(raw.debug?.serverPort, DEFAULT_RUNTIME_CONFIG.debug.serverPort),
      loggingEnabled: toBoolean(raw.debug?.loggingEnabled, DEFAULT_RUNTIME_CONFIG.debug.loggingEnabled),
      antigravityDebug: toBoolean(raw.debug?.antigravityDebug, DEFAULT_RUNTIME_CONFIG.debug.antigravityDebug),
    },
  };
}

export function loadRuntimeConfig(): PonyBunnyRuntimeConfig {
  const configPath = getRuntimeConfigPath();

  if (!fs.existsSync(configPath)) {
    return normalizeConfig(DEFAULT_RUNTIME_CONFIG);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return normalizeConfig(deepMerge(DEFAULT_RUNTIME_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as PonyBunnyRuntimeConfig);
  } catch {
    return normalizeConfig(DEFAULT_RUNTIME_CONFIG);
  }
}

export function saveRuntimeConfig(config: PonyBunnyRuntimeConfig): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(getRuntimeConfigPath(), JSON.stringify(normalizeConfig(config), null, 2), { mode: 0o600 });
}
