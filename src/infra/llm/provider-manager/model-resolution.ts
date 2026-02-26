import type { getCachedConfig } from './config-loader.js';

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
