import type { EndpointId, EndpointConfig } from './endpoint-config.js';

/**
 * All supported endpoint configurations
 */
export const ENDPOINT_CONFIGS: Record<EndpointId, EndpointConfig> = {
  'anthropic-direct': {
    id: 'anthropic-direct',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    requiredEnvVars: ['ANTHROPIC_API_KEY'],
    priority: 1,
    displayName: 'Anthropic Direct',
    description: 'Direct access to Anthropic API',
  },

  'aws-bedrock': {
    id: 'aws-bedrock',
    protocol: 'anthropic',
    baseUrl: 'https://bedrock-runtime.{region}.amazonaws.com',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    optionalEnvVars: ['AWS_REGION'],
    priority: 2,
    costMultiplier: 1.0, // Same pricing as direct
    displayName: 'AWS Bedrock',
    description: 'Claude via AWS Bedrock',
  },

  'openai-direct': {
    id: 'openai-direct',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    requiredEnvVars: ['OPENAI_API_KEY'],
    priority: 1,
    displayName: 'OpenAI Direct',
    description: 'Direct access to OpenAI API',
  },

  'azure-openai': {
    id: 'azure-openai',
    protocol: 'openai',
    baseUrl: '', // Set from AZURE_OPENAI_ENDPOINT
    requiredEnvVars: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
    priority: 2,
    displayName: 'Azure OpenAI',
    description: 'OpenAI models via Azure',
  },

  'openai-compatible': {
    id: 'openai-compatible',
    protocol: 'openai',
    baseUrl: '', // Set from OPENAI_COMPATIBLE_BASE_URL or credentials file
    requiredEnvVars: ['OPENAI_COMPATIBLE_API_KEY'],
    optionalEnvVars: ['OPENAI_COMPATIBLE_BASE_URL'],
    priority: 3,
    displayName: 'OpenAI Compatible',
    description: 'Any OpenAI-compatible API endpoint (e.g., LocalAI, vLLM, Ollama, LM Studio)',
  },

  'google-ai-studio': {
    id: 'google-ai-studio',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiredEnvVars: ['GEMINI_API_KEY'],
    priority: 1,
    displayName: 'Google AI Studio',
    description: 'Direct access to Gemini API',
  },

  'google-vertex-ai': {
    id: 'google-vertex-ai',
    protocol: 'gemini',
    baseUrl: 'https://{region}-aiplatform.googleapis.com/v1',
    requiredEnvVars: ['GOOGLE_CLOUD_PROJECT'],
    optionalEnvVars: ['GOOGLE_CLOUD_REGION'],
    priority: 2,
    displayName: 'Google Vertex AI',
    description: 'Gemini via Google Cloud Vertex AI',
  },
};

/**
 * Get endpoint configuration by ID
 */
export function getEndpointConfig(endpointId: EndpointId): EndpointConfig {
  const config = ENDPOINT_CONFIGS[endpointId];
  if (!config) {
    throw new Error(`Unknown endpoint: ${endpointId}`);
  }
  return config;
}

/**
 * Get all endpoint configurations
 */
export function getAllEndpointConfigs(): EndpointConfig[] {
  return Object.values(ENDPOINT_CONFIGS);
}

/**
 * Get available endpoints (those with required credentials)
 */
export function getAvailableEndpoints(): EndpointConfig[] {
  return getAllEndpointConfigs().filter(config => {
    return config.requiredEnvVars.every(envVar => !!process.env[envVar]);
  });
}

/**
 * Get endpoints by protocol
 */
export function getEndpointsByProtocol(protocol: string): EndpointConfig[] {
  return getAllEndpointConfigs()
    .filter(config => config.protocol === protocol)
    .sort((a, b) => a.priority - b.priority);
}
