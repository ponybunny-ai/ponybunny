import type { ProtocolId } from '../protocols/index.js';
import type { EndpointId } from '../endpoints/index.js';

/**
 * Model routing configuration
 * Maps model patterns to protocols and preferred endpoints
 */
export interface ModelRoutingConfig {
  /** Glob-like pattern for model matching (e.g., 'claude-*', 'gpt-*') */
  pattern: string;
  /** Protocol to use for matching models */
  protocol: ProtocolId;
  /** Ordered list of endpoints to try (first = preferred) */
  endpoints: EndpointId[];
}

/**
 * Default routing configuration
 * Defines how models are routed to protocols and endpoints
 */
export const DEFAULT_ROUTING_CONFIG: ModelRoutingConfig[] = [
  {
    pattern: 'claude-*',
    protocol: 'anthropic',
    endpoints: ['anthropic-direct', 'aws-bedrock'],
  },
  {
    pattern: 'gpt-*',
    protocol: 'openai',
    endpoints: ['openai-direct', 'azure-openai'],
  },
  {
    pattern: 'o1*',
    protocol: 'openai',
    endpoints: ['openai-direct', 'azure-openai'],
  },
  {
    pattern: 'o3*',
    protocol: 'openai',
    endpoints: ['openai-direct', 'azure-openai'],
  },
  {
    pattern: 'gemini-*',
    protocol: 'gemini',
    endpoints: ['google-ai-studio', 'google-vertex-ai'],
  },
];

/**
 * Load endpoint priority overrides from environment
 * Format: PONY_ENDPOINT_PRIORITY_CLAUDE=aws-bedrock,anthropic-direct
 */
export function loadEndpointPriorityOverrides(): Map<string, EndpointId[]> {
  const overrides = new Map<string, EndpointId[]>();

  const envMappings: Record<string, string> = {
    'PONY_ENDPOINT_PRIORITY_CLAUDE': 'claude-*',
    'PONY_ENDPOINT_PRIORITY_GPT': 'gpt-*',
    'PONY_ENDPOINT_PRIORITY_O1': 'o1*',
    'PONY_ENDPOINT_PRIORITY_GEMINI': 'gemini-*',
  };

  for (const [envVar, pattern] of Object.entries(envMappings)) {
    const value = process.env[envVar];
    if (value) {
      const endpoints = value.split(',').map(e => e.trim()) as EndpointId[];
      overrides.set(pattern, endpoints);
    }
  }

  return overrides;
}

/**
 * Get routing config with environment overrides applied
 */
export function getRoutingConfig(): ModelRoutingConfig[] {
  const overrides = loadEndpointPriorityOverrides();

  return DEFAULT_ROUTING_CONFIG.map(config => {
    const override = overrides.get(config.pattern);
    if (override && override.length > 0) {
      return { ...config, endpoints: override };
    }
    return config;
  });
}
