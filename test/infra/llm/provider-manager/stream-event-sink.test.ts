import * as fs from 'fs';
import * as path from 'path';
import {
  LLMProviderManager,
  configureLLMProviderManagerStreamEventSink,
  createNoOpLLMStreamEventSink,
  getCachedConfig,
  getLLMProviderManager,
  resetEndpointManager,
  resetLLMProviderManager,
  resetWorkloadModelResolver,
  clearConfigCache,
} from '../../../../src/infra/llm/provider-manager/index.js';
import { EventBus } from '../../../../src/gateway/events/event-bus.js';
import { GatewayLLMStreamEventSink } from '../../../../src/gateway/events/llm-stream-event-sink.js';

jest.mock('../../../../src/infra/config/credentials-loader.js', () => ({
  clearCredentialsCache: jest.fn(),
  getCachedEndpointCredential: jest.fn((endpointId: string) => {
    if (endpointId === 'openai') {
      return { apiKey: 'test-openai-key' };
    }

    if (endpointId === 'custom-openai-endpoint') {
      return {
        apiKey: 'test-openai-compatible-key',
        baseUrl: 'https://proxy.example.com',
      };
    }

    return null;
  }),
}));

const providerManagerPath = path.resolve(
  process.cwd(),
  'src/infra/llm/provider-manager/provider-manager.ts'
);

function createStreamingResponse(...events: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(events.join('\n')));
        controller.close();
      },
    }),
    {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'text/event-stream',
      },
    }
  );
}

describe('LLMProviderManager stream event sink boundary', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetLLMProviderManager();
    resetEndpointManager();
    resetWorkloadModelResolver();
    clearConfigCache();
    configureLLMProviderManagerStreamEventSink(createNoOpLLMStreamEventSink());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetLLMProviderManager();
    resetEndpointManager();
    resetWorkloadModelResolver();
    clearConfigCache();
  });

  it('no longer imports gatewayEventBus directly in provider-manager', () => {
    const source = fs.readFileSync(providerManagerPath, 'utf8');

    expect(source).not.toContain("from '../../../gateway/events/event-bus.js'");
    expect(source).not.toContain('gatewayEventBus.emit(');
  });

  it('preserves gateway-visible stream events when a gateway adapter is bound', async () => {
    const gatewayBus = new EventBus();
    const manager = getLLMProviderManager();
    const streamEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const onChunk = jest.fn();
    const onComplete = jest.fn();

    gatewayBus.on('llm.stream.start', (payload: unknown) => {
      streamEvents.push({ event: 'llm.stream.start', payload: payload as Record<string, unknown> });
    });
    gatewayBus.on('llm.stream.chunk', (payload: unknown) => {
      streamEvents.push({ event: 'llm.stream.chunk', payload: payload as Record<string, unknown> });
    });
    gatewayBus.on('llm.stream.end', (payload: unknown) => {
      streamEvents.push({ event: 'llm.stream.end', payload: payload as Record<string, unknown> });
    });
    gatewayBus.on('llm.stream.error', (payload: unknown) => {
      streamEvents.push({ event: 'llm.stream.error', payload: payload as Record<string, unknown> });
    });

    configureLLMProviderManagerStreamEventSink(new GatewayLLMStreamEventSink(gatewayBus));

    global.fetch = jest.fn(async () =>
      createStreamingResponse(
        'data: {"type":"response.output_text.delta","delta":"Hel"}',
        'data: {"type":"response.output_text.delta","delta":"lo"}',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}',
        'data: [DONE]'
      )
    ) as typeof fetch;

    const response = await manager.completeWithModel(
      'openai.gpt-5.2',
      [{ role: 'user', content: 'ping' }],
      {
        stream: true,
        goalId: 'goal-1',
        workItemId: 'work-1',
        runId: 'run-1',
        onChunk,
        onComplete,
      }
    );

    expect(response.content).toBe('Hello');
    expect(response.tokensUsed).toBe(5);
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hel', 0);
    expect(onChunk).toHaveBeenNthCalledWith(2, 'lo', 1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello', tokensUsed: 5 }));
    expect(streamEvents.map(({ event }) => event)).toEqual([
      'llm.stream.start',
      'llm.stream.chunk',
      'llm.stream.chunk',
      'llm.stream.end',
    ]);

    const requestId = streamEvents[0]?.payload.requestId;
    expect(streamEvents[0]?.payload).toEqual(expect.objectContaining({
      requestId,
      goalId: 'goal-1',
      workItemId: 'work-1',
      runId: 'run-1',
      model: 'openai.gpt-5.2',
    }));
    expect(streamEvents[1]?.payload).toEqual(expect.objectContaining({
      requestId,
      goalId: 'goal-1',
      chunk: 'Hel',
      index: 0,
    }));
    expect(streamEvents[2]?.payload).toEqual(expect.objectContaining({
      requestId,
      goalId: 'goal-1',
      chunk: 'lo',
      index: 1,
    }));
    expect(streamEvents[3]?.payload).toEqual(expect.objectContaining({
      requestId,
      goalId: 'goal-1',
      totalChunks: 2,
      tokensUsed: 5,
      finishReason: 'stop',
    }));
  });

  it('uses the no-op sink safely when no gateway-owned sink is bound', async () => {
    global.fetch = jest.fn(async () =>
      createStreamingResponse(
        'data: {"type":"response.output_text.delta","delta":"safe"}',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}'
      )
    ) as typeof fetch;

    const manager = new LLMProviderManager();
    const onChunk = jest.fn();
    const onComplete = jest.fn();

    const response = await manager.completeWithModel(
      'openai.gpt-5.2',
      [{ role: 'user', content: 'ping' }],
      {
        stream: true,
        onChunk,
        onComplete,
      }
    );

    expect(response.content).toBe('safe');
    expect(response.tokensUsed).toBe(2);
    expect(onChunk).toHaveBeenCalledWith('safe', 0);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'safe', tokensUsed: 2 }));
  });

  it('preserves fallback and callback behavior across streaming endpoint failures', async () => {
    const config = getCachedConfig();

    config.providers['custom-openai-endpoint'] = {
      enabled: true,
      protocol: 'openai',
      baseUrl: 'https://proxy.example.com',
      priority: 2,
      requiredEnvVars: ['OPENAI_COMPATIBLE_API_KEY'],
    };
    config.models['stream-fallback-model'] = {
      displayName: 'Stream fallback model',
      providers: ['custom-openai-endpoint', 'openai'],
      costPer1kTokens: { input: 0.001, output: 0.002 },
    };

    const onChunk = jest.fn();
    const onComplete = jest.fn();
    const onError = jest.fn();

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'first endpoint unavailable' } }),
          {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        createStreamingResponse(
          'data: {"type":"response.output_text.delta","delta":"fallback"}',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}'
        )
      );

    const manager = new LLMProviderManager();
    const response = await manager.completeWithModel(
      'stream-fallback-model',
      [{ role: 'user', content: 'ping' }],
      {
        stream: true,
        onChunk,
        onComplete,
        onError,
      }
    );

    expect(response.content).toBe('fallback');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onChunk).toHaveBeenCalledWith('fallback', 0);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ content: 'fallback', tokensUsed: 5 }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
