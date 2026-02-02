import { randomBytes } from 'crypto';
import {
  ANTIGRAVITY_ENDPOINT,
  ANTIGRAVITY_ENDPOINT_AUTOPUSH,
  ANTIGRAVITY_ENDPOINT_PROD,
  GEMINI_CLI_ENDPOINT,
  getRandomizedHeaders,
  type HeaderStyle,
} from './antigravity-constants.js';
import { accountManagerV2 } from './auth-manager-v2.js';
import { parseRateLimitInfo } from './rate-limit.js';

export interface GeminiContentPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
  thought?: boolean;
  thoughtSignature?: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
}

export interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: Record<string, unknown>;
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<Record<string, unknown>>;
}

export interface AntigravityRequestOptions {
  model: string;
  request: GeminiRequest;
  modelFamily?: 'claude' | 'gemini';
  signal?: AbortSignal;
  maxRetries?: number;
}

export interface AntigravityResponse {
  response: Record<string, unknown>;
  traceId?: string;
}

type AntigravitySession = NonNullable<Awaited<ReturnType<typeof accountManagerV2.getAntigravitySession>>>;

type RequestContext = {
  session: AntigravitySession;
  headerStyle: HeaderStyle;
  endpoint: string;
};

function logDebug(message: string, extra?: Record<string, unknown>): void {
  if (process.env.PB_ANTIGRAVITY_DEBUG === '1' || process.env.PB_DEBUG === '1') {
    const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
    console.log(`[AntigravityClient] ${message}${suffix}`);
  }
}

function logWarn(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.warn(`[AntigravityClient] ${message}${suffix}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequestId(): string {
  return `pb_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

function inferModelFamily(model: string): 'claude' | 'gemini' {
  const lower = model.toLowerCase();
  if (lower.includes('claude')) return 'claude';
  return 'gemini';
}

function resolveEndpoint(headerStyle: HeaderStyle): string {
  const envOverride = process.env.PB_ANTIGRAVITY_ENDPOINT;
  if (envOverride) {
    return envOverride;
  }

  const env = process.env.PB_ANTIGRAVITY_ENV;
  if (env === 'prod') return ANTIGRAVITY_ENDPOINT_PROD;
  if (env === 'autopush') return ANTIGRAVITY_ENDPOINT_AUTOPUSH;
  if (env === 'daily' || env === 'sandbox') return ANTIGRAVITY_ENDPOINT;

  return headerStyle === 'gemini-cli' ? GEMINI_CLI_ENDPOINT : ANTIGRAVITY_ENDPOINT;
}

function buildHeaders(context: RequestContext): Record<string, string> {
  const baseHeaders = getRandomizedHeaders(context.headerStyle);
  const fingerprint = context.session?.account.fingerprint;
  const userAgent = context.headerStyle === 'gemini-cli'
    ? baseHeaders['User-Agent']
    : fingerprint?.userAgent ?? baseHeaders['User-Agent'];

  return {
    Authorization: `Bearer ${context.session.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': userAgent,
    'X-Goog-Api-Client': baseHeaders['X-Goog-Api-Client'],
    'Client-Metadata': baseHeaders['Client-Metadata'],
  };
}

function extractTextFromResponse(payload: AntigravityResponse | Record<string, unknown>): string | undefined {
  const response = 'response' in payload ? (payload as AntigravityResponse).response : payload;
  const candidates = (response as any)?.candidates;
  const first = Array.isArray(candidates) ? candidates[0] : undefined;
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part: any) => part?.text)
    .filter((value: any) => typeof value === 'string')
    .join('');
  return text || undefined;
}

export class AntigravityClient {
  async generateContent(options: AntigravityRequestOptions): Promise<AntigravityResponse> {
    return this.requestWithRetries({
      ...options,
      streaming: false,
    }) as Promise<AntigravityResponse>;
  }

  async streamGenerateContent(
    options: AntigravityRequestOptions,
    onChunk: (text: string, raw: Record<string, unknown>) => void,
  ): Promise<void> {
    await this.requestWithRetries({
      ...options,
      streaming: true,
      onChunk,
    });
  }

  private async requestWithRetries(options: AntigravityRequestOptions & {
    streaming: boolean;
    onChunk?: (text: string, raw: Record<string, unknown>) => void;
  }): Promise<AntigravityResponse | void> {
    const maxAttempts = (options.maxRetries ?? 3) + 1;
    const modelFamily = options.modelFamily ?? inferModelFamily(options.model);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const session = await accountManagerV2.getAntigravitySession({
        modelFamily,
        model: options.model,
      });

      if (!session) {
        throw new Error('No Antigravity accounts available. Run `pb auth antigravity login`.');
      }

      const context: RequestContext = {
        session,
        headerStyle: session.headerStyle,
        endpoint: resolveEndpoint(session.headerStyle),
      };

      const url = options.streaming
        ? `${context.endpoint}/v1internal:streamGenerateContent?alt=sse`
        : `${context.endpoint}/v1internal:generateContent`;

      const headers = buildHeaders(context);
      if (options.streaming) {
        headers.Accept = 'text/event-stream';
      }

      const body = JSON.stringify({
        project: session.projectId,
        model: options.model,
        request: options.request,
        userAgent: 'antigravity',
        requestId: createRequestId(),
      });

      logDebug('Sending Antigravity request', {
        attempt,
        model: options.model,
        endpoint: context.endpoint,
        headerStyle: context.headerStyle,
        streaming: options.streaming,
      });

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: options.signal,
        });
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw new Error(`Antigravity request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await this.applyBackoff(attempt);
        continue;
      }

      if (response.ok) {
        if (options.streaming) {
          await this.consumeStream(response, options.onChunk);
          accountManagerV2.markRequestSuccess(session.account.id);
          return;
        }

        const payload = await response.json() as AntigravityResponse;
        accountManagerV2.markRequestSuccess(session.account.id);
        return payload;
      }

      const bodyText = await response.text().catch(() => response.statusText);
      const rateLimitInfo = response.status === 429 || response.status === 503
        ? parseRateLimitInfo({
            response,
            bodyText,
            model: options.model,
            headerStyle: context.headerStyle,
          })
        : null;

      if (rateLimitInfo) {
        const backoffMs = accountManagerV2.markRateLimited(session.account.id, {
          modelFamily,
          reason: rateLimitInfo.reason,
          retryAfterMs: rateLimitInfo.retryAfter,
          headerStyle: context.headerStyle,
        });

        logWarn('Rate limited, rotating account', {
          account: session.account.email,
          reason: rateLimitInfo.reason,
          backoffMs,
        });

        if (attempt >= maxAttempts) {
          throw new Error(`Antigravity rate limit: ${bodyText}`);
        }

        await sleep(Math.min(backoffMs, 2000));
        continue;
      }

      accountManagerV2.markRequestFailure(session.account.id);

      if ((response.status === 401 || response.status === 403) && attempt < maxAttempts) {
        accountManagerV2.invalidateAntigravityAccess(session.account.id);
        await this.applyBackoff(attempt);
        continue;
      }

      if (response.status >= 500 && attempt < maxAttempts) {
        await this.applyBackoff(attempt);
        continue;
      }

      throw new Error(`Antigravity API error (${response.status}): ${bodyText}`);
    }

    throw new Error('Antigravity request failed after retries');
  }

  private async consumeStream(response: Response, onChunk?: (text: string, raw: Record<string, unknown>) => void): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.trim() !== '');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.replace(/^data:\s*/, '');
        if (!data || data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const text = extractTextFromResponse(parsed);
          if (text && onChunk) {
            onChunk(text, parsed);
          }
        } catch {
          continue;
        }
      }
    }
  }

  private async applyBackoff(attempt: number): Promise<void> {
    const base = 500;
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(8000, base * Math.pow(2, attempt - 1) + jitter);
    await sleep(delay);
  }
}

export const antigravityClient = new AntigravityClient();
