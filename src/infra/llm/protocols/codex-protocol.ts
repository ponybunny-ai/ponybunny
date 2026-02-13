import type { LLMMessage, LLMResponse } from '../llm-provider.js';
import type {
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
} from './protocol-adapter.js';
import { BaseProtocolAdapter } from './protocol-adapter.js';

function getAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload['https://api.openai.com/auth']?.chatgpt_account_id || null;
  } catch {
    return null;
  }
}

/**
 * Codex Protocol Adapter
 * Handles communication with ChatGPT Backend API using OAuth tokens
 */
export class CodexProtocolAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'codex' as const;

  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown {
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    const model = config.model;

    return {
      model,
      store: false,
      stream: true,
      instructions: systemMessage?.content || 'You are a helpful AI assistant.',
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
      text: {
        verbosity: 'medium',
      },
      include: ['reasoning.encrypted_content'],
      input: userMessages.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.content || '',
      })),
    };
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as any;

    const content =
      data?.choices?.[0]?.message?.content ??
      data?.message?.content?.parts?.join('') ??
      data?.output?.[0]?.content?.[0]?.text ??
      data?.output_text ??
      '';

    const inputTokens = data?.usage?.input_tokens;
    const outputTokens = data?.usage?.output_tokens;

    const tokensUsed =
      data?.usage?.total_tokens ??
      data?.usage?.total_tokens_used ??
      (typeof inputTokens === 'number' && typeof outputTokens === 'number'
        ? inputTokens + outputTokens
        : 0);

    return {
      content,
      tokensUsed,
      model: data.model || model,
      finishReason: 'stop',
    };
  }

  buildHeaders(credentials: EndpointCredentials): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs',
    };

    if (credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
      
      const accountId = getAccountId(credentials.accessToken);
      if (accountId) {
        headers['ChatGPT-Account-Id'] = accountId;
      }
    }

    return headers;
  }

  buildUrl(baseUrl: string, _model: string, _credentials: EndpointCredentials): string {
    const root = baseUrl || 'https://chatgpt.com/backend-api';
    return `${root.replace(/\/$/, '')}/codex/responses`;
  }

  isRecoverableError(status: number, _response?: unknown): boolean {
    // 429 is rate limit (standard)
    return status !== 429 && status >= 500;
  }

  supportsStreaming(): boolean {
    return true;
  }

  parseStreamChunk(line: string, _chunkIndex: number): import('../llm-provider.js').StreamChunk | null {
    if (!line.trim() || line.startsWith('event:')) {
      return null;
    }

    if (!line.startsWith('data:')) {
      return null;
    }

    const jsonStr = line.slice(5).trim();
    if (!jsonStr) return null;

    let data: any;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    const type = data?.type;
    if (type === 'response.output_text.delta') {
      const delta = data?.delta;
      if (typeof delta === 'string' && delta.length > 0) {
        return { content: delta, done: false };
      }
      return null;
    }

    if (type === 'response.reasoning_summary_text.delta') {
      const delta = data?.delta;
      if (typeof delta === 'string' && delta.length > 0) {
        return { thinking: delta, done: false };
      }
      return null;
    }

    if (type === 'response.completed') {
      return { done: true, finishReason: 'stop' };
    }

    if (type === 'response.failed' || type === 'error') {
      return { done: true, finishReason: 'error' };
    }

    return null;
  }
}

/**
 * Singleton instance
 */
let instance: CodexProtocolAdapter | null = null;

export function getCodexProtocol(): CodexProtocolAdapter {
  if (!instance) {
    instance = new CodexProtocolAdapter();
  }
  return instance;
}
