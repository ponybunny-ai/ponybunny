import type { GatewayChannelType } from './channel-router.js';

export type GatewayChannelAdapterConfig = Record<string, unknown>;
export type GatewayChannelAdapterConfigMap = Partial<Record<GatewayChannelType, GatewayChannelAdapterConfig>>;

export interface AdapterRetryPolicy {
  attempts: number;
  backoffMs: number;
}

export const DEFAULT_ADAPTER_RETRY_POLICY: AdapterRetryPolicy = {
  attempts: 2,
  backoffMs: 50,
};

const SECRET_KEYS = new Set(['botToken', 'webhookVerifyToken']);

const DEFAULT_CONFIGS: Record<Exclude<GatewayChannelType, 'tui'>, GatewayChannelAdapterConfig> = {
  webui: {
    origin: '*',
    corsEnabled: true,
    retryAttempts: DEFAULT_ADAPTER_RETRY_POLICY.attempts,
    retryBackoffMs: DEFAULT_ADAPTER_RETRY_POLICY.backoffMs,
  },
  email: {
    inboundAddress: '',
    smtpHost: '',
    smtpPort: 587,
    useTls: true,
    retryAttempts: DEFAULT_ADAPTER_RETRY_POLICY.attempts,
    retryBackoffMs: DEFAULT_ADAPTER_RETRY_POLICY.backoffMs,
  },
  telegram: {
    botToken: '',
    webhookUrl: '',
    pollingEnabled: false,
    retryAttempts: DEFAULT_ADAPTER_RETRY_POLICY.attempts,
    retryBackoffMs: DEFAULT_ADAPTER_RETRY_POLICY.backoffMs,
  },
  whatsapp: {
    provider: 'meta',
    phoneNumberId: '',
    webhookVerifyToken: '',
    retryAttempts: DEFAULT_ADAPTER_RETRY_POLICY.attempts,
    retryBackoffMs: DEFAULT_ADAPTER_RETRY_POLICY.backoffMs,
  },
  discord: {
    botToken: '',
    webhookUrl: '',
    guildId: '',
    applicationId: '',
    commandsEnabled: true,
    retryAttempts: DEFAULT_ADAPTER_RETRY_POLICY.attempts,
    retryBackoffMs: DEFAULT_ADAPTER_RETRY_POLICY.backoffMs,
  },
};

function cloneConfig(config: GatewayChannelAdapterConfig): GatewayChannelAdapterConfig {
  return { ...config };
}

function maskSecrets(config: GatewayChannelAdapterConfig): GatewayChannelAdapterConfig {
  const masked: GatewayChannelAdapterConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEYS.has(key)) {
      if (typeof value === 'string' && value.length > 0) {
        masked[key] = '***';
      } else {
        masked[key] = '';
      }
      continue;
    }
    masked[key] = value;
  }

  return masked;
}

export function normalizeAdapterConfig(
  channel: GatewayChannelType,
  config: GatewayChannelAdapterConfig | undefined
): GatewayChannelAdapterConfig {
  if (channel === 'tui') {
    return cloneConfig(config ?? {});
  }

  const defaults = DEFAULT_CONFIGS[channel];
  return {
    ...defaults,
    ...(config ?? {}),
  };
}

export function normalizeAdapterConfigMap(configs: GatewayChannelAdapterConfigMap): GatewayChannelAdapterConfigMap {
  const normalized: GatewayChannelAdapterConfigMap = {};
  for (const [channel, config] of Object.entries(configs)) {
    normalized[channel as GatewayChannelType] = normalizeAdapterConfig(channel as GatewayChannelType, config);
  }
  return normalized;
}

export function sanitizeAdapterConfig(
  channel: GatewayChannelType,
  config: GatewayChannelAdapterConfig | undefined
): GatewayChannelAdapterConfig {
  return maskSecrets(normalizeAdapterConfig(channel, config));
}

export function sanitizeAdapterConfigMap(configs: GatewayChannelAdapterConfigMap): GatewayChannelAdapterConfigMap {
  const sanitized: GatewayChannelAdapterConfigMap = {};
  for (const [channel, config] of Object.entries(configs)) {
    sanitized[channel as GatewayChannelType] = sanitizeAdapterConfig(channel as GatewayChannelType, config);
  }
  return sanitized;
}

export interface AdapterConfigDiffEntry {
  channel: GatewayChannelType;
  changedKeys: string[];
  changedCategories: {
    credentials: string[];
    policy: string[];
    routing: string[];
    other: string[];
  };
}

export interface AdapterConfigImpactSummary {
  credentialsChanged: boolean;
  policyChanged: boolean;
  routingChanged: boolean;
  otherChanged: boolean;
}

const CREDENTIAL_KEYS = new Set(['botToken', 'webhookVerifyToken']);
const POLICY_KEYS = new Set(['retryAttempts', 'retryBackoffMs', 'commandsEnabled', 'pollingEnabled', 'useTls', 'corsEnabled']);
const ROUTING_KEYS = new Set(['origin', 'inboundAddress', 'smtpHost', 'smtpPort', 'webhookUrl', 'provider', 'phoneNumberId', 'guildId', 'applicationId']);

function categorizeChangedKey(key: string): keyof AdapterConfigDiffEntry['changedCategories'] {
  if (CREDENTIAL_KEYS.has(key)) {
    return 'credentials';
  }
  if (POLICY_KEYS.has(key)) {
    return 'policy';
  }
  if (ROUTING_KEYS.has(key)) {
    return 'routing';
  }

  return 'other';
}

export function diffAdapterConfigMaps(
  before: GatewayChannelAdapterConfigMap,
  after: GatewayChannelAdapterConfigMap
): AdapterConfigDiffEntry[] {
  const channels = new Set<GatewayChannelType>([
    ...Object.keys(before) as GatewayChannelType[],
    ...Object.keys(after) as GatewayChannelType[],
  ]);

  const diffs: AdapterConfigDiffEntry[] = [];
  for (const channel of channels) {
    const beforeConfig = sanitizeAdapterConfig(channel, before[channel]);
    const afterConfig = sanitizeAdapterConfig(channel, after[channel]);
    const keys = new Set([...Object.keys(beforeConfig), ...Object.keys(afterConfig)]);
    const changedKeys: string[] = [];
    for (const key of keys) {
      if (!Object.is(beforeConfig[key], afterConfig[key])) {
        changedKeys.push(key);
      }
    }

    if (changedKeys.length > 0) {
      const categories: AdapterConfigDiffEntry['changedCategories'] = {
        credentials: [],
        policy: [],
        routing: [],
        other: [],
      };
      for (const key of changedKeys) {
        categories[categorizeChangedKey(key)].push(key);
      }

      diffs.push({
        channel,
        changedKeys: changedKeys.sort(),
        changedCategories: {
          credentials: categories.credentials.sort(),
          policy: categories.policy.sort(),
          routing: categories.routing.sort(),
          other: categories.other.sort(),
        },
      });
    }
  }

  return diffs;
}

export function summarizeAdapterConfigImpact(diff: AdapterConfigDiffEntry[]): AdapterConfigImpactSummary {
  const summary: AdapterConfigImpactSummary = {
    credentialsChanged: false,
    policyChanged: false,
    routingChanged: false,
    otherChanged: false,
  };

  for (const entry of diff) {
    if (entry.changedCategories.credentials.length > 0) {
      summary.credentialsChanged = true;
    }
    if (entry.changedCategories.policy.length > 0) {
      summary.policyChanged = true;
    }
    if (entry.changedCategories.routing.length > 0) {
      summary.routingChanged = true;
    }
    if (entry.changedCategories.other.length > 0) {
      summary.otherChanged = true;
    }
  }

  return summary;
}

export function resolveAdapterRetryPolicy(config: GatewayChannelAdapterConfig | undefined): AdapterRetryPolicy {
  const attemptsRaw = config?.retryAttempts;
  const backoffRaw = config?.retryBackoffMs;

  const attempts =
    typeof attemptsRaw === 'number' && Number.isInteger(attemptsRaw) && attemptsRaw >= 1 && attemptsRaw <= 5
      ? attemptsRaw
      : DEFAULT_ADAPTER_RETRY_POLICY.attempts;
  const backoffMs =
    typeof backoffRaw === 'number' && Number.isInteger(backoffRaw) && backoffRaw >= 0 && backoffRaw <= 10_000
      ? backoffRaw
      : DEFAULT_ADAPTER_RETRY_POLICY.backoffMs;

  return { attempts, backoffMs };
}
