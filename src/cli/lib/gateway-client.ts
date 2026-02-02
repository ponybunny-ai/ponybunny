import { authManager } from './auth-manager.js';

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

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export class GatewayClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = authManager.getGatewayUrl();
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = authManager.getAccessToken();
    
    if (!token) {
      throw new Error('Not authenticated. Run `pb auth login` first.');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new Error(`API request failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.request<ChatCompletionResponse>('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const token = authManager.getAccessToken();
    
    if (!token) {
      throw new Error('Not authenticated. Run `pb auth login` first.');
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
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
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              onChunk(content);
            }
          } catch {
          }
        }
      }
    }
  }

  async createGoal(params: {
    title: string;
    description: string;
    success_criteria?: Array<any>;
    budget_tokens?: number;
  }): Promise<Goal> {
    return this.request<Goal>('/v1/goals', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async listGoals(): Promise<Goal[]> {
    return this.request<Goal[]>('/v1/goals');
  }

  async getGoal(id: string): Promise<Goal> {
    return this.request<Goal>(`/v1/goals/${id}`);
  }
}

export const gatewayClient = new GatewayClient();
