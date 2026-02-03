import { accountManagerV2 } from './auth-manager-v2.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

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

export class OpenAIClient {
  private baseUrl = 'https://chatgpt.com/backend-api';

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await accountManagerV2.getAccessToken('codex');
    
    if (!token) {
      throw new Error('Not authenticated. Run `pb auth login` first.');
    }

    const accountId = getAccountId(token);
    if (!accountId) {
      throw new Error('Could not extract account ID from token');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'ChatGPT-Account-Id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'codex_cli_rs',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI API request failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.request<{ models: Array<{ id: string }> }>('/models');
      return response.models?.map(m => m.id) ?? [];
    } catch (error) {
      console.warn('Failed to fetch models from OpenAI, using defaults');
      return ['gpt-5.2', 'gpt-5.2-codex', 'gpt-4o', 'gpt-4'];
    }
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const userMessages = request.messages.filter(m => m.role !== 'system');
    
    const body = {
      model: request.model === 'gpt-5.2' ? 'gpt-5.2-codex' : request.model,
      store: false,
      stream: false,
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
        role: m.role,
        content: m.content,
      })),
    };

    return this.request<ChatCompletionResponse>('/codex/responses', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const token = await accountManagerV2.getAccessToken('codex');
    
    if (!token) {
      throw new Error('Not authenticated. Run `pb auth login` first.');
    }

    const accountId = getAccountId(token);
    if (!accountId) {
      throw new Error('Could not extract account ID from token');
    }

    const systemMessage = request.messages.find(m => m.role === 'system');
    const userMessages = request.messages.filter(m => m.role !== 'system');

    const body = {
      model: request.model === 'gpt-5.2' ? 'gpt-5.2-codex' : request.model,
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
        role: m.role,
        content: m.content,
      })),
    };

    const response = await fetch(`${this.baseUrl}/codex/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${token}`,
        'ChatGPT-Account-Id': accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'codex_cli_rs',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || 
                           parsed.output?.content ||
                           parsed.text;
            if (content) {
              onChunk(content);
            }
          } catch {
          }
        }
      }
    }
  }
}

export const openaiClient = new OpenAIClient();
