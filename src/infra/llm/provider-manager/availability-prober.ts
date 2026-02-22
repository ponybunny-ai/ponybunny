import { getProtocolAdapter } from '../protocols/index.js';
import type { EndpointCredentials } from '../protocols/index.js';
import type { LLMConfig } from './types.js';
import { loadLLMConfig, saveLLMConfig, clearConfigCache } from './config-loader.js';
import { EndpointManager, getEndpointManager } from './endpoint-manager.js';
import { LLMProviderError } from '../llm-provider.js';

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
  failures: Array<{ endpointId: string; modelId: string; error: string }>;
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
  modelId: string,
  timeoutMs: number
): Promise<{ available: boolean; error?: string }> {
  const endpointConfig = config.endpoints[endpointId];
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

  const requestBody = adapter.formatRequest(
    [{ role: 'user', content: 'Reply with exactly: pong' }],
    {
      model: modelId,
      maxTokens: 12,
      temperature: 0,
      tool_choice: 'none',
      stream: false,
      thinking: false,
    }
  );

  const baseUrl = credentials.baseUrl || endpointConfig.baseUrl || '';
  const url = adapter.buildUrl(baseUrl, modelId, endpointCreds);
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
      modelId
    );

    return { available: true };
  } catch (error) {
    if (error instanceof LLMProviderError) {
      return { available: false, error: error.message };
    }

    return { available: false, error: (error as Error).message };
  }
}

export async function probeAndPersistAvailability(options: ProbeOptions = {}): Promise<ProbeSummary> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxModelsPerEndpoint = options.maxModelsPerEndpoint ?? 20;
  const checkedAt = new Date().toISOString();
  const endpointManager = getEndpointManager();
  const config = loadLLMConfig();

  const enabledEndpointIds = Object.entries(config.endpoints)
    .filter(([_, endpoint]) => endpoint.enabled === true)
    .map(([endpointId]) => endpointId);

  const failures: Array<{ endpointId: string; modelId: string; error: string }> = [];
  let modelEndpointChecks = 0;
  let endpointAvailable = 0;
  let modelEndpointAvailable = 0;

  for (const endpointId of enabledEndpointIds) {
    const endpointConfig = config.endpoints[endpointId];
    const candidateModels = Object.entries(config.models)
      .filter(([_, model]) => model.endpoints.includes(endpointId))
      .map(([modelId]) => modelId)
      .slice(0, maxModelsPerEndpoint);

    const successfulModels: string[] = [];
    const failedModels: string[] = [];
    let lastError: string | undefined;

    for (const modelId of candidateModels) {
      modelEndpointChecks += 1;

      const result = await probeEndpointModel(endpointManager, config, endpointId, modelId, timeoutMs);
      if (result.available) {
        successfulModels.push(modelId);
        modelEndpointAvailable += 1;
      } else {
        failedModels.push(modelId);
        lastError = result.error;
        failures.push({ endpointId, modelId, error: result.error || 'Unknown probe failure' });
      }

      const modelConfig = config.models[modelId];
      if (!modelConfig.health) {
        modelConfig.health = { lastCheckedAt: checkedAt, endpoints: {} };
      }
      modelConfig.health.lastCheckedAt = checkedAt;
      modelConfig.health.endpoints[endpointId] = {
        available: result.available,
        lastError: result.error,
      };
    }

    const isEndpointAvailable = successfulModels.length > 0 || (candidateModels.length === 0 && endpointManager.hasCredentials(endpointId));
    if (isEndpointAvailable) {
      endpointAvailable += 1;
    }

    endpointConfig.health = {
      available: isEndpointAvailable,
      lastCheckedAt: checkedAt,
      lastError,
      successfulModels,
      failedModels,
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
