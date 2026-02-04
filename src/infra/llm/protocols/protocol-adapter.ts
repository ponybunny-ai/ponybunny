import type { LLMMessage, LLMResponse } from '../llm-provider.js';

/**
 * Supported protocol identifiers
 */
export type ProtocolId = 'anthropic' | 'openai' | 'gemini';

/**
 * Credentials for endpoint authentication
 */
export interface EndpointCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  projectId?: string;
}

/**
 * Request configuration for protocol adapters
 */
export interface ProtocolRequestConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

/**
 * Raw response from API before parsing
 */
export interface RawApiResponse {
  status: number;
  statusText: string;
  data: unknown;
  headers?: Record<string, string>;
}

/**
 * Protocol adapter interface
 * Handles API format conversion between internal types and provider-specific formats
 */
export interface IProtocolAdapter {
  /** Protocol identifier */
  readonly protocolId: ProtocolId;

  /**
   * Format messages and config into provider-specific request body
   */
  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown;

  /**
   * Parse provider-specific response into standard LLMResponse
   */
  parseResponse(response: RawApiResponse, model: string): LLMResponse;

  /**
   * Build headers for the request
   */
  buildHeaders(credentials: EndpointCredentials): Record<string, string>;

  /**
   * Build the full URL for the request
   */
  buildUrl(baseUrl: string, model: string, credentials: EndpointCredentials): string;

  /**
   * Check if an error response is recoverable (can retry with fallback)
   */
  isRecoverableError(status: number, response?: unknown): boolean;

  /**
   * Extract error message from response
   */
  extractErrorMessage(response: unknown): string;
}

/**
 * Base class for protocol adapters with common functionality
 */
export abstract class BaseProtocolAdapter implements IProtocolAdapter {
  abstract readonly protocolId: ProtocolId;

  abstract formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown;
  abstract parseResponse(response: RawApiResponse, model: string): LLMResponse;
  abstract buildHeaders(credentials: EndpointCredentials): Record<string, string>;

  buildUrl(baseUrl: string, _model: string, _credentials: EndpointCredentials): string {
    return baseUrl;
  }

  isRecoverableError(status: number, _response?: unknown): boolean {
    // Rate limiting (429) is not recoverable within same endpoint
    // Server errors (5xx) are potentially recoverable with fallback
    return status !== 429 && status >= 500;
  }

  extractErrorMessage(response: unknown): string {
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      if (resp.error && typeof resp.error === 'object') {
        const error = resp.error as Record<string, unknown>;
        if (typeof error.message === 'string') {
          return error.message;
        }
      }
      if (typeof resp.message === 'string') {
        return resp.message;
      }
    }
    return 'Unknown error';
  }

  /**
   * Map finish reason to standard format
   */
  protected mapFinishReason(reason: string | undefined): 'stop' | 'length' | 'error' {
    if (!reason) return 'stop';
    const normalized = reason.toLowerCase();
    if (normalized === 'stop' || normalized === 'end_turn') return 'stop';
    if (normalized === 'length' || normalized === 'max_tokens') return 'length';
    return 'error';
  }
}
