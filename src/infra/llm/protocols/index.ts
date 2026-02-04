// Protocol types and interfaces
export type {
  ProtocolId,
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
  IProtocolAdapter,
} from './protocol-adapter.js';

export { BaseProtocolAdapter } from './protocol-adapter.js';

// Protocol implementations
export { AnthropicProtocolAdapter, getAnthropicProtocol } from './anthropic-protocol.js';
export { OpenAIProtocolAdapter, getOpenAIProtocol } from './openai-protocol.js';
export { GeminiProtocolAdapter, getGeminiProtocol } from './gemini-protocol.js';

import type { ProtocolId, IProtocolAdapter } from './protocol-adapter.js';
import { getAnthropicProtocol } from './anthropic-protocol.js';
import { getOpenAIProtocol } from './openai-protocol.js';
import { getGeminiProtocol } from './gemini-protocol.js';

/**
 * Get protocol adapter by ID
 */
export function getProtocolAdapter(protocolId: ProtocolId): IProtocolAdapter {
  switch (protocolId) {
    case 'anthropic':
      return getAnthropicProtocol();
    case 'openai':
      return getOpenAIProtocol();
    case 'gemini':
      return getGeminiProtocol();
    default:
      throw new Error(`Unknown protocol: ${protocolId}`);
  }
}
