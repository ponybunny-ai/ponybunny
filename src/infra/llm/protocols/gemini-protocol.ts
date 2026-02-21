import type { LLMMessage, LLMResponse, ToolCall, StreamChunk } from '../llm-provider.js';
import type {
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
} from './protocol-adapter.js';
import { BaseProtocolAdapter } from './protocol-adapter.js';

/**
 * Google Gemini API protocol adapter
 * Supports both Google AI Studio and Vertex AI endpoints
 */
export class GeminiProtocolAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'gemini' as const;

  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown {
    // Extract system message and conversation messages
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Convert to Gemini format
    const contents = conversationMessages.map(m => {
      // Handle tool result messages
      if (m.role === 'tool' && m.tool_call_id) {
        return {
          role: 'function',
          parts: [{
            functionResponse: {
              name: m.tool_call_id, // Gemini uses the function name, not the call ID
              response: {
                result: m.content || '',
              },
            },
          }],
        };
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const parts: any[] = [];

        // Add text content if present
        if (m.content) {
          parts.push({ text: m.content });
        }

        // Add function calls
        for (const toolCall of m.tool_calls) {
          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
            },
          });
        }

        return {
          role: 'model',
          parts,
        };
      }

      // Regular messages
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }],
      };
    });

    const systemInstruction = systemMessage
      ? { parts: [{ text: systemMessage.content }] }
      : undefined;

    const requestBody: any = {
      contents,
      systemInstruction,
      generationConfig: {
        maxOutputTokens: config.maxTokens || 4000,
        temperature: config.temperature ?? 0.7,
      },
    };

    // Add tools if provided
    if (config.tools && config.tools.length > 0) {
      requestBody.tools = [{
        function_declarations: config.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      }];
    }

    // Add tool_choice if specified (Gemini uses tool_config)
    if (config.tool_choice) {
      if (config.tool_choice === 'auto') {
        requestBody.tool_config = {
          function_calling_config: {
            mode: 'AUTO',
          },
        };
      } else if (config.tool_choice === 'required') {
        requestBody.tool_config = {
          function_calling_config: {
            mode: 'ANY',
          },
        };
      } else if (config.tool_choice === 'none') {
        requestBody.tool_config = {
          function_calling_config: {
            mode: 'NONE',
          },
        };
      } else {
        requestBody.tool_config = {
          function_calling_config: {
            mode: 'ANY',
            allowed_function_names: [config.tool_choice.function.name],
          },
        };
      }
    }

    return requestBody;
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: {
              name: string;
              args: any;
            };
          }>;
        };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
      promptFeedback?: { blockReason?: string };
    };

    // Extract text and function calls from response
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const candidates = data.candidates;

    if (Array.isArray(candidates) && candidates.length > 0) {
      const firstCandidate = candidates[0];
      const parts = firstCandidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.text) {
            textParts.push(part.text);
          } else if (part?.functionCall) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
            });
          }
        }
      }
    }

    const content = textParts.join('') || null;

    // Extract token usage
    const usageMetadata = data.usageMetadata;
    const tokensUsed = (usageMetadata?.promptTokenCount || 0) +
                       (usageMetadata?.candidatesTokenCount || 0);

    // Map finish reason
    const finishReason = this.mapGeminiFinishReason(candidates?.[0]?.finishReason);

    return {
      content,
      tokensUsed,
      model,
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  buildHeaders(_credentials: EndpointCredentials): Record<string, string> {
    // Gemini uses API key in URL query param, not headers
    return {
      'Content-Type': 'application/json',
    };
  }

  buildUrl(baseUrl: string, model: string, credentials: EndpointCredentials): string {
    // Google AI Studio format
    if (baseUrl.includes('generativelanguage.googleapis.com')) {
      return `${baseUrl}/models/${model}:generateContent?key=${credentials.apiKey}`;
    }
    // Vertex AI format
    if (baseUrl.includes('aiplatform.googleapis.com')) {
      const region = credentials.region || 'us-central1';
      const projectId = credentials.projectId;
      return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
    }
    return baseUrl;
  }

  isRecoverableError(status: number, response?: unknown): boolean {
    // Check for blocked content
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      if (resp.promptFeedback && typeof resp.promptFeedback === 'object') {
        const feedback = resp.promptFeedback as Record<string, unknown>;
        if (feedback.blockReason) {
          return false; // Content blocked, not recoverable
        }
      }
    }
    return status !== 429;
  }

  extractErrorMessage(response: unknown): string {
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      // Check for block reason
      if (resp.promptFeedback && typeof resp.promptFeedback === 'object') {
        const feedback = resp.promptFeedback as Record<string, unknown>;
        if (feedback.blockReason) {
          return `Content blocked: ${feedback.blockReason}`;
        }
      }
    }
    return super.extractErrorMessage(response);
  }

  supportsStreaming(): boolean {
    return true;
  }

  parseStreamChunk(line: string, _chunkIndex: number): StreamChunk | null {
    // Skip empty lines and comments
    if (!line.trim() || line.startsWith(':')) {
      return null;
    }

    // Gemini uses JSON streaming (newline-delimited JSON), not SSE
    // Each line is a complete JSON object
    try {
      const data = JSON.parse(line) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: {
                name: string;
                args: any;
              };
            }>;
          };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };

      const candidate = data.candidates?.[0];
      if (!candidate) {
        return null;
      }

      // Extract text content and function calls
      const textParts: string[] = [];
      const parts = candidate.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.text) {
            textParts.push(part.text);
          } else if (part?.functionCall) {
            // Function call in streaming - we'll skip for now
            // Full implementation would need state management
            return null;
          }
        }
      }

      const content = textParts.join('');

      // Check for finish reason
      if (candidate.finishReason) {
        return {
          content,
          done: true,
          finishReason: this.mapGeminiFinishReason(candidate.finishReason),
        };
      }

      // Return content chunk
      if (content) {
        return {
          content,
          done: false,
        };
      }

      return null;
    } catch (error) {
      console.warn('[GeminiProtocol] Failed to parse stream chunk:', error);
      return null;
    }
  }

  private mapGeminiFinishReason(reason?: string): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        return reason ? 'error' : 'stop';
    }
  }
}

/**
 * Singleton instance
 */
let instance: GeminiProtocolAdapter | null = null;

export function getGeminiProtocol(): GeminiProtocolAdapter {
  if (!instance) {
    instance = new GeminiProtocolAdapter();
  }
  return instance;
}
