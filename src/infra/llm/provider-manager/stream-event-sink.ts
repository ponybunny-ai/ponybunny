export interface LLMStreamStartEvent {
  requestId: string;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  model: string;
  timestamp: number;
}

export interface LLMStreamChunkEvent {
  requestId: string;
  goalId?: string;
  chunk: string;
  index: number;
  timestamp: number;
}

export interface LLMStreamEndEvent {
  requestId: string;
  goalId?: string;
  totalChunks: number;
  tokensUsed: number;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  timestamp: number;
}

export interface LLMStreamErrorEvent {
  requestId: string;
  goalId?: string;
  error: string;
  timestamp: number;
}

export interface LLMStreamEventSink {
  streamStarted(event: LLMStreamStartEvent): void;
  streamChunk(event: LLMStreamChunkEvent): void;
  streamEnded(event: LLMStreamEndEvent): void;
  streamErrored(event: LLMStreamErrorEvent): void;
}

class NoOpLLMStreamEventSink implements LLMStreamEventSink {
  streamStarted(_event: LLMStreamStartEvent): void {}

  streamChunk(_event: LLMStreamChunkEvent): void {}

  streamEnded(_event: LLMStreamEndEvent): void {}

  streamErrored(_event: LLMStreamErrorEvent): void {}
}

export function createNoOpLLMStreamEventSink(): LLMStreamEventSink {
  return new NoOpLLMStreamEventSink();
}
