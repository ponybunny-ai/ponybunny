import { gatewayEventBus } from './event-bus.js';
import type {
  LLMStreamChunkEvent,
  LLMStreamEndEvent,
  LLMStreamErrorEvent,
  LLMStreamEventSink,
  LLMStreamStartEvent,
} from '../../infra/llm/provider-manager/stream-event-sink.js';

type EventPublisher = Pick<typeof gatewayEventBus, 'emit'>;

export class GatewayLLMStreamEventSink implements LLMStreamEventSink {
  constructor(private readonly eventBus: EventPublisher = gatewayEventBus) {}

  streamStarted(event: LLMStreamStartEvent): void {
    this.eventBus.emit('llm.stream.start', event);
  }

  streamChunk(event: LLMStreamChunkEvent): void {
    this.eventBus.emit('llm.stream.chunk', event);
  }

  streamEnded(event: LLMStreamEndEvent): void {
    this.eventBus.emit('llm.stream.end', event);
  }

  streamErrored(event: LLMStreamErrorEvent): void {
    this.eventBus.emit('llm.stream.error', event);
  }
}
