import type { ILLMProvider, LLMMessage, LLMResponse, LLMProviderConfig } from './llm-provider.js';
import { LLMProviderError } from './llm-provider.js';
import type { AccountManagerV2 } from '../../cli/lib/auth-manager-v2.js';

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

export class CodexAccountProvider implements ILLMProvider {
  private baseUrl = 'https://chatgpt.com/backend-api';
  
  constructor(
    private accountManager: AccountManagerV2,
    private config: Partial<LLMProviderConfig> = {}
  ) {}

  async complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
    const model = mergedConfig.model || 'gpt-5.2-codex';
    
    const token = await this.accountManager.getAccessToken('codex');
    if (!token) {
      throw new LLMProviderError('Not authenticated with Codex', 'codex', false);
    }

    const accountId = getAccountId(token);
    if (!accountId) {
      throw new LLMProviderError('Could not extract account ID from token', 'codex', false);
    }

    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system');
    
    try {
      const response = await fetch(`${this.baseUrl}/conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'ChatGPT-Account-Id': accountId,
          'OpenAI-Beta': 'responses=experimental',
          'originator': 'codex_cli_rs',
        },
        body: JSON.stringify({
          model: model === 'gpt-5.2' ? 'gpt-5.2-codex' : model,
          store: false,
          stream: false,
          instructions: systemMessage?.content || 'You are a helpful AI assistant.',
          reasoning: {
            effort: 'medium',
            summary: 'auto',
          },
          messages: userMessages.map(m => ({
            role: m.role,
            content: { content_type: 'text', parts: [m.content] },
          })),
        }),
        signal: AbortSignal.timeout(mergedConfig.timeout || 60000),
      });

      if (!response.ok) {
        const error = await response.text().catch(() => response.statusText);
        throw new LLMProviderError(
          `Codex API error: ${response.status} ${error}`,
          'codex',
          response.status !== 429
        );
      }

      const data = await response.json() as any;
      const content = data.message?.content?.parts?.join('') || '';
      
      return {
        content,
        tokensUsed: data.usage?.total_tokens || 0,
        model: data.model || model,
        finishReason: 'stop',
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }
      
      throw new LLMProviderError(
        `Codex request failed: ${(error as Error).message}`,
        'codex',
        true
      );
    }
  }

  getName(): string {
    return `codex-${this.config.model || 'gpt-5.2-codex'}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const token = await this.accountManager.getAccessToken('codex');
      return !!token;
    } catch {
      return false;
    }
  }

  estimateCost(tokens: number): number {
    return (tokens / 1000) * 0.01;
  }
}

export class AntigravityAccountProvider implements ILLMProvider {
  constructor(
    private accountManager: AccountManagerV2,
    private config: Partial<LLMProviderConfig> = {}
  ) {}

  async complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
    const model = mergedConfig.model || 'gemini-2.5-flash';
    
    const session = await this.accountManager.getAntigravitySession();
    if (!session) {
      throw new LLMProviderError('Not authenticated with Antigravity', 'antigravity', false);
    }

    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const geminiContents = conversationMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));

    const systemInstruction = systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined;

    try {
      const endpoint = process.env.PB_ANTIGRAVITY_ENDPOINT || 'https://cloudcode-pa.googleapis.com';
      const response = await fetch(`${endpoint}/v1/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.accessToken}`,
          'x-goog-user-project': session.projectId,
        },
        body: JSON.stringify({
          contents: geminiContents,
          systemInstruction,
          generationConfig: {
            maxOutputTokens: mergedConfig.maxTokens || 4000,
            temperature: mergedConfig.temperature ?? 0.7,
          },
        }),
        signal: AbortSignal.timeout(mergedConfig.timeout || 60000),
      });

      if (!response.ok) {
        const error = await response.text().catch(() => response.statusText);
        throw new LLMProviderError(
          `Antigravity API error: ${response.status} ${error}`,
          'antigravity',
          response.status !== 429
        );
      }

      const data = await response.json() as any;
      const textParts: string[] = [];
      const responseCandidates = data?.candidates;
      
      if (Array.isArray(responseCandidates)) {
        const firstCandidate = responseCandidates[0];
        const parts = firstCandidate?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part?.text) {
              textParts.push(part.text);
            }
          }
        }
      }
      
      const content = textParts.join('') || 'No response from model';
      const tokensUsed = data?.usageMetadata?.totalTokenCount || 0;
      
      return {
        content,
        tokensUsed,
        model,
        finishReason: 'stop',
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }
      
      throw new LLMProviderError(
        `Antigravity request failed: ${(error as Error).message}`,
        'antigravity',
        true
      );
    }
  }

  getName(): string {
    return `antigravity-${this.config.model || 'gemini-2.5-flash'}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const session = await this.accountManager.getAntigravitySession();
      return !!session;
    } catch {
      return false;
    }
  }

  estimateCost(tokens: number): number {
    return (tokens / 1000) * 0.0001;
  }
}
