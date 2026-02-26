import type { ProtocolId } from '../protocols/index.js';
import type { EndpointId, EndpointConfig } from '../endpoints/index.js';
import { getEndpointConfig, hasRequiredCredentials } from '../endpoints/index.js';
import type { ModelRoutingConfig } from './routing-config.js';
import { getRoutingConfig } from './routing-config.js';
import {
  getModelConfig as getLLMModelConfig,
  getEndpointConfig as getLLMEndpointConfig,
  getCachedConfig,
} from '../provider-manager/config-loader.js';
import { authManagerV2 } from '../../../cli/lib/auth-manager-v2.js';

function safeGetEndpointConfig(endpointId: string): EndpointConfig | null {
  try {
    return getEndpointConfig(endpointId as EndpointId);
  } catch {
    return null;
  }
}

/**
 * Model router for determining protocol and endpoints for a given model
 */
export class ModelRouter {
  private routingConfig: ModelRoutingConfig[];
  private useLLMConfig: boolean;
  private availabilityCache = new Map<EndpointId, boolean>();

  constructor(routingConfig?: ModelRoutingConfig[]) {
    this.routingConfig = routingConfig ?? getRoutingConfig();
    this.useLLMConfig = routingConfig === undefined;
  }

  /**
   * Get the protocol for a model
   */
  getProtocolForModel(modelId: string): ProtocolId | undefined {
    const selectorResolution = this.useLLMConfig
      ? this.resolveModelSelector(modelId)
      : { modelId };
    const llmModelConfig = this.useLLMConfig ? getLLMModelConfig(selectorResolution.modelId) : undefined;
    if (llmModelConfig) {
      if (selectorResolution.providerAliasId) {
        const aliasProtocol = getCachedConfig().providerAliases?.[selectorResolution.providerAliasId]?.protocol;
        if (aliasProtocol) {
          return aliasProtocol;
        }
      }

      const providerCandidates = Array.isArray(llmModelConfig.providers) && llmModelConfig.providers.length > 0
        ? llmModelConfig.providers
        : this.inferProvidersFromModelId(selectorResolution.modelId);
      const firstEndpointId = providerCandidates[0];
      if (!firstEndpointId) return undefined;
      const endpoint = safeGetEndpointConfig(firstEndpointId);
      return endpoint?.protocol;
    }

    const config = this.findRoutingConfig(modelId);
    return config?.protocol;
  }

  /**
   * Get available endpoints for a model, ordered by priority
   */
  getEndpointsForModel(modelId: string): EndpointConfig[] {
    console.log(`🔍 [ModelRouter] Resolving endpoints for model: ${modelId}`);

    const selectorResolution = this.useLLMConfig
      ? this.resolveModelSelector(modelId)
      : { modelId };
    const llmModelConfig = this.useLLMConfig ? getLLMModelConfig(selectorResolution.modelId) : undefined;
    const modelProviders = llmModelConfig
      ? (Array.isArray(llmModelConfig.providers) && llmModelConfig.providers.length > 0
        ? llmModelConfig.providers
        : this.inferProvidersFromModelId(selectorResolution.modelId))
      : [];
    const candidateEndpointIds: string[] = llmModelConfig
      ? modelProviders.filter(endpointId => {
        if (!selectorResolution.providerScope) {
          return true;
        }
        return selectorResolution.providerScope.has(endpointId);
      })
      : [];

    if (llmModelConfig) {
      console.log(`✅ [ModelRouter] Exact model match in llm-config: ${selectorResolution.modelId}`);
      console.log(`📋 [ModelRouter] Candidate providers from llm-config.models['${selectorResolution.modelId}'].providers: ${candidateEndpointIds.join(', ')}`);
    } else {
      console.log(`⚠️ [ModelRouter] No exact model match in llm-config for: ${modelId}`);
    }

    const routingConfig = llmModelConfig ? undefined : this.findRoutingConfig(modelId);
    const fallbackEndpointIds = routingConfig?.endpoints ?? [];

    const endpointIdsToTry = llmModelConfig ? candidateEndpointIds : fallbackEndpointIds;

    if (!llmModelConfig && routingConfig) {
      console.log(`✅ [ModelRouter] Matched pattern '${routingConfig.pattern}' -> Protocol '${routingConfig.protocol}'`);
      console.log(`📋 [ModelRouter] Candidate endpoints from routing-config: ${endpointIdsToTry.join(', ')}`);
    }

    if (endpointIdsToTry.length === 0) {
      console.log(`❌ [ModelRouter] No candidate endpoints for model: ${modelId}`);
      return [];
    }

    const endpointsWithMeta = endpointIdsToTry
      .map(endpointId => {
        const endpoint = safeGetEndpointConfig(endpointId);
        if (!endpoint) return null;

        const llmEndpointConfig = getLLMEndpointConfig(endpointId);
        if (llmEndpointConfig && llmEndpointConfig.enabled === false) {
          console.log(`⚠️ [ModelRouter] Provider ${endpointId} disabled in llm-config.providers`);
          return null;
        }

        if (llmEndpointConfig?.health?.available === false) {
          console.log(`⚠️ [ModelRouter] Endpoint ${endpointId} marked unavailable by probe health`);
          return null;
        }

        if (llmModelConfig?.health?.providers?.[endpointId]?.available === false) {
          console.log(`⚠️ [ModelRouter] Endpoint ${endpointId} marked unavailable for model ${modelId} by probe health`);
          return null;
        }

        const baseUrlOverride = llmEndpointConfig?.baseUrl;
        return baseUrlOverride ? { ...endpoint, baseUrl: baseUrlOverride } : endpoint;
      })
      .filter((config): config is EndpointConfig => config !== null)
      .filter(config => {
        const available = this.isEndpointAvailable(config.id);
        if (!available) {
          console.log(`⚠️ [ModelRouter] Endpoint ${config.id} is unavailable (missing credentials/disabled)`);
        }
        return available;
      });

    const isOAuthEndpoint = (endpoint: EndpointConfig): boolean => endpoint.protocol === 'codex';
    const endpoints = endpointsWithMeta
      .map((endpoint, index) => ({ endpoint, index }))
      .sort((a, b) => {
        const ao = isOAuthEndpoint(a.endpoint) ? 0 : 1;
        const bo = isOAuthEndpoint(b.endpoint) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.index - b.index;
      })
      .map(x => x.endpoint);

    console.log(`✅ [ModelRouter] Final available endpoints (oauth preferred): ${endpoints.map(e => e.id).join(', ')}`);
    return endpoints;
  }

  private inferProvidersFromModelId(modelId: string): string[] {
    const dotIndex = modelId.indexOf('.');
    if (dotIndex <= 0 || dotIndex === modelId.length - 1) {
      return [];
    }
    return [modelId.slice(0, dotIndex)];
  }

  /**
   * Check if an endpoint is available (has required credentials)
   */
  isEndpointAvailable(endpointId: EndpointId): boolean {
    try {
      const llmEndpointConfig = getLLMEndpointConfig(endpointId);

      if (llmEndpointConfig?.enabled === false) {
        this.availabilityCache.set(endpointId, false);
        return false;
      }

      if (llmEndpointConfig?.health?.available === false) {
        this.availabilityCache.set(endpointId, false);
        return false;
      }

      if (this.availabilityCache.has(endpointId)) {
        return this.availabilityCache.get(endpointId)!;
      }

      const config = getEndpointConfig(endpointId);

      const hasCreds = hasRequiredCredentials(config);
      let available = hasCreds;

      if (available && config.protocol === 'codex') {
        available = authManagerV2.isAuthenticated();
      }

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
        console.log(`✅ [ModelRouter] Matched pattern '${config.pattern}' -> Protocol '${config.protocol}'`);
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

  private resolveModelSelector(
    modelSelector: string
  ): { modelId: string; providerAliasId?: string; providerScope?: Set<string> } {
    const config = getCachedConfig();

    if (config.models[modelSelector]) {
      return { modelId: modelSelector };
    }

    const dotIndex = modelSelector.indexOf('.');
    if (dotIndex <= 0 || dotIndex === modelSelector.length - 1) {
      return { modelId: modelSelector };
    }

    const providerAliasId = modelSelector.slice(0, dotIndex);
    const modelSuffix = modelSelector.slice(dotIndex + 1);

    const directModelId = `${providerAliasId}.${modelSuffix}`;
    if (config.models[directModelId]) {
      return {
        modelId: directModelId,
        providerAliasId,
        providerScope: new Set([providerAliasId]),
      };
    }

    const modelId = modelSuffix;
    const providerAlias = config.providerAliases?.[providerAliasId];
    if (!providerAlias) {
      return { modelId: modelSelector };
    }

    if (!config.models[modelId]) {
      return { modelId: modelSelector };
    }

    return {
      modelId,
      providerAliasId,
      providerScope: new Set(providerAlias.providers),
    };
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
