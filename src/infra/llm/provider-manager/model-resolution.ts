import type { getCachedConfig } from './config-loader.js';
import type { LLMConfig } from './types.js';

export function parseProviderFromModelSelector(modelSelector: string): string | undefined {
  const dotIndex = modelSelector.indexOf('.');
  if (dotIndex <= 0 || dotIndex === modelSelector.length - 1) {
    return undefined;
  }
  return modelSelector.slice(0, dotIndex);
}

export function getProviderIdsForModel(
  modelSelector: string,
  resolvedModelId: string,
  modelConfig: ReturnType<typeof getCachedConfig>['models'][string],
  providerScope?: Set<string>
): string[] {
  const fromModelConfig = Array.isArray(modelConfig.providers)
    ? modelConfig.providers
    : [];

  const providerFromSelector = parseProviderFromModelSelector(modelSelector)
    || parseProviderFromModelSelector(resolvedModelId);

  const inferred = providerFromSelector ? [providerFromSelector] : [];
  const candidates = fromModelConfig.length > 0 ? fromModelConfig : inferred;

  if (!providerScope) {
    return candidates;
  }

  return candidates.filter(endpointId => providerScope.has(endpointId));
}

export function resolveProviderRequestModel(modelId: string, config: LLMConfig): string {
  const dotIndex = modelId.indexOf('.');
  if (dotIndex <= 0 || dotIndex === modelId.length - 1) {
    return modelId;
  }

  const candidatePrefix = modelId.slice(0, dotIndex);
  const suffix = modelId.slice(dotIndex + 1);
  const isProviderPrefix = Boolean(config.providers[candidatePrefix]);
  const isAliasPrefix = Boolean(config.providerAliases?.[candidatePrefix]);

  if (!isProviderPrefix && !isAliasPrefix) {
    return modelId;
  }

  return suffix;
}
