import { createHash } from 'node:crypto';

import { getCachedEndpointCredential } from '../../infra/config/credentials-loader.js';
import type { IEmbeddingService } from './memory-service.js';

type EmbeddingMode = 'none' | 'openai' | 'custom';

interface EmbeddingServiceOptions {
  fetcher?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class LocalEmbeddingService implements IEmbeddingService {
  readonly model: string;
  readonly dimensions: number;
  private mode: EmbeddingMode;
  private providerValue: string;
  private fetcher: typeof fetch;
  private baseUrl?: string;
  private apiKey?: string;

  constructor(provider: string, options: EmbeddingServiceOptions = {}) {
    this.providerValue = provider && provider.trim().length > 0 ? provider.trim() : 'none';
    this.fetcher = options.fetcher ?? fetch;
    this.model = options.model ?? process.env.PONY_MEMORY_EMBEDDING_MODEL ?? 'text-embedding-3-small';

    if (this.providerValue === 'openai') {
      this.mode = 'openai';
      this.baseUrl = normalizeBaseUrl(
        options.baseUrl ||
          process.env.PONY_MEMORY_OPENAI_BASE_URL ||
          process.env.OPENAI_BASE_URL ||
          getCachedEndpointCredential('openai-direct')?.baseUrl ||
          'https://api.openai.com/v1'
      );
      this.apiKey =
        options.apiKey || process.env.OPENAI_API_KEY || getCachedEndpointCredential('openai-direct')?.apiKey;
      this.dimensions = 1536;
      return;
    }

    if (this.providerValue.startsWith('custom:')) {
      this.mode = 'custom';
      this.baseUrl = normalizeBaseUrl(this.providerValue.slice('custom:'.length));
      this.apiKey =
        options.apiKey ||
        process.env.PONY_MEMORY_EMBEDDING_API_KEY ||
        process.env.OPENAI_API_KEY ||
        getCachedEndpointCredential('openai-direct')?.apiKey;
      this.dimensions = 1536;
      return;
    }

    this.mode = 'none';
    this.dimensions = 256;
  }

  async embed(text: string): Promise<Float32Array> {
    if (this.mode === 'openai' || this.mode === 'custom') {
      return this.embedWithOpenAICompatible(text);
    }

    const normalized = normalizeInput(text);
    const vector = new Float32Array(this.dimensions);

    if (normalized.length === 0) {
      return vector;
    }

    const tokens = normalized.split(' ');
    for (const token of tokens) {
      const hash = createHash('sha256').update(token).digest();
      const index = hash.readUInt16BE(0) % this.dimensions;
      const sign = (hash[2] ?? 0) % 2 === 0 ? 1 : -1;
      const magnitude = ((hash[3] ?? 0) + 1) / 256;
      vector[index] = (vector[index] ?? 0) + sign * magnitude;
    }

    return normalize(vector);
  }

  private async embedWithOpenAICompatible(text: string): Promise<Float32Array> {
    if (!this.baseUrl) {
      throw new Error('Memory embedding provider base URL is not configured');
    }
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new Error('OpenAI embedding provider requires API key');
    }

    const response = await this.fetcher(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding response missing vector data');
    }

    const output = Float32Array.from(embedding);
    this.assertFiniteVector(output);
    return normalize(output);
  }

  private assertFiniteVector(vector: Float32Array): void {
    for (let index = 0; index < vector.length; index += 1) {
      const value = vector[index];
      if (!Number.isFinite(value)) {
        throw new Error('Embedding response contains non-finite values');
      }
    }
  }
}

function normalizeInput(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalize(value: Float32Array): Float32Array {
  let norm = 0;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] ?? 0;
    norm += item * item;
  }

  const length = Math.sqrt(norm);
  if (length === 0) {
    return value;
  }

  for (let index = 0; index < value.length; index += 1) {
    value[index] = (value[index] ?? 0) / length;
  }

  return value;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
