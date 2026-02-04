import type { ProtocolId } from '../protocols/index.js';
import type { EndpointId, EndpointConfig } from '../endpoints/index.js';
import { getEndpointConfig, hasRequiredCredentials } from '../endpoints/index.js';
import type { ModelRoutingConfig } from './routing-config.js';
import { getRoutingConfig } from './routing-config.js';

/**
 * Model router for determining protocol and endpoints for a given model
 */
export class ModelRouter {
  private routingConfig: ModelRoutingConfig[];
  private availabilityCache = new Map<EndpointId, boolean>();

  constructor(routingConfig?: ModelRoutingConfig[]) {
    this.routingConfig = routingConfig || getRoutingConfig();
  }

  /**
   * Get the protocol for a model
   */
  getProtocolForModel(modelId: string): ProtocolId | undefined {
    const config = this.findRoutingConfig(modelId);
    return config?.protocol;
  }

  /**
   * Get available endpoints for a model, ordered by priority
   */
  getEndpointsForModel(modelId: string): EndpointConfig[] {
    const config = this.findRoutingConfig(modelId);
    if (!config) {
      return [];
    }

    return config.endpoints
      .map(endpointId => {
        try {
          return getEndpointConfig(endpointId);
        } catch {
          return null;
        }
      })
      .filter((config): config is EndpointConfig => config !== null)
      .filter(config => this.isEndpointAvailable(config.id));
  }

  /**
   * Check if an endpoint is available (has required credentials)
   */
  isEndpointAvailable(endpointId: EndpointId): boolean {
    // Check cache first
    if (this.availabilityCache.has(endpointId)) {
      return this.availabilityCache.get(endpointId)!;
    }

    try {
      const config = getEndpointConfig(endpointId);
      const available = hasRequiredCredentials(config);
      this.availabilityCache.set(endpointId, available);
      return available;
    } catch {
      this.availabilityCache.set(endpointId, false);
      return false;
    }
  }

  /**
   * Get the first available endpoint for a model
   */
  getPreferredEndpoint(modelId: string): EndpointConfig | undefined {
    const endpoints = this.getEndpointsForModel(modelId);
    return endpoints[0];
  }

  /**
   * Check if a model is supported by any available endpoint
   */
  isModelSupported(modelId: string): boolean {
    return this.getEndpointsForModel(modelId).length > 0;
  }

  /**
   * Get all supported model patterns
   */
  getSupportedPatterns(): string[] {
    return this.routingConfig.map(c => c.pattern);
  }

  /**
   * Clear the availability cache (useful when env vars change)
   */
  clearCache(): void {
    this.availabilityCache.clear();
  }

  /**
   * Find routing config for a model using pattern matching
   */
  private findRoutingConfig(modelId: string): ModelRoutingConfig | undefined {
    for (const config of this.routingConfig) {
      if (this.matchPattern(modelId, config.pattern)) {
        return config;
      }
    }
    return undefined;
  }

  /**
   * Match a model ID against a pattern
   * Supports simple glob patterns with * wildcard
   */
  private matchPattern(modelId: string, pattern: string): boolean {
    // Convert glob pattern to regex
    // * matches any characters
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*'); // Convert * to .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(modelId);
  }
}

/**
 * Singleton instance
 */
let instance: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!instance) {
    instance = new ModelRouter();
  }
  return instance;
}

export function resetModelRouter(): void {
  instance = null;
}
