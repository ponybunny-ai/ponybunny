import { getLLMProviderManager } from '../../infra/llm/provider-manager/index.js';

export function getSchedulerConfiguredProviderIds(): string[] {
  try {
    return getLLMProviderManager().getEnabledEndpoints().map((endpoint) => endpoint.id);
  } catch {
    return [];
  }
}
