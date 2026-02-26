import { getProtocolAdapter } from '../protocols/index.js';
import type { EndpointCredentials } from '../protocols/index.js';
import type { ProtocolRequestConfig } from '../protocols/index.js';
import type { LLMConfig } from './types.js';
import { loadLLMConfig, saveLLMConfig, clearConfigCache } from './config-loader.js';
import { EndpointManager, getEndpointManager } from './endpoint-manager.js';
import { LLMProviderError } from '../llm-provider.js';
import { parseProviderFromModelSelector } from './model-resolution.js';
import type { LLMModelConfig } from './types.js';

export interface ProbeOptions {
  timeoutMs?: number;
  maxModelsPerEndpoint?: number;
}

export interface ProbeSummary {
  checkedAt: string;
  endpointCount: number;
  modelEndpointChecks: number;
  endpointAvailable: number;
  modelEndpointAvailable: number;
  failures: Array<{ endpointId: string; modelId: string; sourceModelId: string; error: string }>;
}

function selectCandidateModelsForEndpoint(config: LLMConfig, endpointId: string): string[] {
  const modelIds = Object.keys(config.models);
  const directScoped = modelIds.filter(modelId => parseProviderFromModelSelector(modelId) === endpointId);
  if (directScoped.length > 0) {
    return directScoped;
  }

  return modelIds.filter(modelId => {
    const model = config.models[modelId];
    return Array.isArray(model.providers) && model.providers.includes(endpointId);
  });
}

async function probeEndpointBaseUrl(
  config: LLMConfig,
  endpointManager: EndpointManager,
  endpointId: string,
  timeoutMs: number
): Promise<{ available: boolean; error?: string }> {
  const endpointConfig = config.providers[endpointId];
  if (!endpointConfig || endpointConfig.enabled !== true) {
    return { available: false, error: 'Endpoint disabled or missing from config' };
  }

  const credentials = endpointManager.resolveCredentials(endpointId);
  const baseUrl = credentials?.baseUrl || endpointConfig.baseUrl || '';
  if (!baseUrl) {
    return { available: false, error: 'Missing endpoint baseUrl' };
  }

  try {
    new URL(baseUrl);
  } catch {
    return { available: false, error: `Invalid endpoint baseUrl: ${baseUrl}` };
  }

  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status >= 500) {
      return { available: false, error: `${response.status} ${response.statusText || 'Server Error'}` };
    }

    return { available: true };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

function buildHeaders(
  endpointId: string,
  credentials: EndpointCredentials,
  adapter: ReturnType<typeof getProtocolAdapter>
): Record<string, string> {
  if (endpointId === 'azure-openai') {
    return {
      'Content-Type': 'application/json',
      'api-key': credentials.apiKey || '',
    };
  }

  return adapter.buildHeaders(credentials);
}

async function probeEndpointModel(
  endpointManager: EndpointManager,
  config: LLMConfig,
  endpointId: string,
  modelConfig: LLMModelConfig,
  requestModelId: string,
  timeoutMs: number
): Promise<{ available: boolean; error?: string }> {
  const endpointConfig = config.providers[endpointId];
  if (!endpointConfig || endpointConfig.enabled !== true) {
    return { available: false, error: 'Endpoint disabled or missing from config' };
  }

  const credentials = endpointManager.resolveCredentials(endpointId);
  if (!credentials) {
    return { available: false, error: 'Missing endpoint credentials' };
  }

  const adapter = getProtocolAdapter(endpointConfig.protocol);
  const endpointCreds: EndpointCredentials = {
    apiKey: credentials.apiKey,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: credentials.region,
    projectId: credentials.projectId,
  };

  const probeMaxTokens = resolveProbeMaxTokens(config, modelConfig);

  const requestConfig: ProtocolRequestConfig = {
    model: requestModelId,
    maxTokens: probeMaxTokens,
    temperature: 0,
    tool_choice: 'none',
    stream: false,
    thinking: false,
    openaiOperation: 'responses',
    openaiEndpointUrl: '/v1/responses',
  };

  const requestBody = adapter.formatRequest(
    [{ role: 'user', content: 'Reply with exactly: pong' }],
    requestConfig
  );

  const baseUrl = credentials.baseUrl || endpointConfig.baseUrl || '';
  const url = adapter.buildUrl(baseUrl, requestModelId, endpointCreds, requestConfig);
  const headers = buildHeaders(endpointId, endpointCreds, adapter);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data = await response.json().catch(() => ({ error: { message: response.statusText } }));

    if (!response.ok) {
      const errorMessage = adapter.extractErrorMessage(data);
      return { available: false, error: `${response.status} ${errorMessage}` };
    }

    adapter.parseResponse(
      {
        status: response.status,
        statusText: response.statusText,
        data,
      },
      requestModelId
    );

    return { available: true };
  } catch (error) {
    if (error instanceof LLMProviderError) {
      return { available: false, error: error.message };
    }

    return { available: false, error: (error as Error).message };
  }
}

function resolveProbeMaxTokens(config: LLMConfig, modelConfig: LLMModelConfig): number {
  const configuredDefault = typeof config.defaults?.maxTokens === 'number' && config.defaults.maxTokens > 0
    ? config.defaults.maxTokens
    : 64;
  const modelMax = typeof modelConfig.maxOutputTokens === 'number' && modelConfig.maxOutputTokens > 0
    ? modelConfig.maxOutputTokens
    : undefined;

  if (modelMax && modelMax < 16) {
    return modelMax;
  }

  const bounded = modelMax ? Math.min(configuredDefault, modelMax) : configuredDefault;
  return Math.max(16, bounded);
}

function resolveProbeRequestModel(modelId: string, config: LLMConfig): string {
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

export async function probeAndPersistAvailability(options: ProbeOptions = {}): Promise<ProbeSummary> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxModelsPerEndpoint = options.maxModelsPerEndpoint ?? 20;
  const checkedAt = new Date().toISOString();
  const endpointManager = getEndpointManager();
  const config = loadLLMConfig();

  const enabledEndpointIds = Object.entries(config.providers)
    .filter(([_, endpoint]) => endpoint.enabled === true)
    .map(([endpointId]) => endpointId);

  const failures: Array<{ endpointId: string; modelId: string; sourceModelId: string; error: string }> = [];
  let modelEndpointChecks = 0;
  let endpointAvailable = 0;
  let modelEndpointAvailable = 0;

  for (const endpointId of enabledEndpointIds) {
    const endpointConfig = config.providers[endpointId];
    const candidateModels = selectCandidateModelsForEndpoint(config, endpointId)
      .slice(0, maxModelsPerEndpoint);

    const endpointBaseProbe = await probeEndpointBaseUrl(config, endpointManager, endpointId, timeoutMs);

    for (const modelId of candidateModels) {
      modelEndpointChecks += 1;
      const requestModelId = resolveProbeRequestModel(modelId, config);
      const modelConfig = config.models[modelId];

      const result = await probeEndpointModel(
        endpointManager,
        config,
        endpointId,
        modelConfig,
        requestModelId,
        timeoutMs
      );
      if (result.available) {
        modelEndpointAvailable += 1;
      } else {
        failures.push({
          endpointId,
          modelId: requestModelId,
          sourceModelId: modelId,
          error: result.error || 'Unknown probe failure',
        });
      }

      const priorHealth = modelConfig.health;
      const available = Boolean(priorHealth?.available) || result.available;
      modelConfig.health = {
        lastCheckedAt: checkedAt,
        available,
        lastError: available ? undefined : result.error ?? priorHealth?.lastError,
      };
    }

    if (endpointBaseProbe.available) {
      endpointAvailable += 1;
    }

    endpointConfig.health = {
      available: endpointBaseProbe.available,
      lastCheckedAt: checkedAt,
      lastError: endpointBaseProbe.error,
    };
  }

  saveLLMConfig(config);
  clearConfigCache();
  endpointManager.clearHealthCache();

  return {
    checkedAt,
    endpointCount: enabledEndpointIds.length,
    modelEndpointChecks,
    endpointAvailable,
    modelEndpointAvailable,
    failures,
  };
}
