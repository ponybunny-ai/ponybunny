/**
 * LLM event handlers.
 */

import type { IEventHandler } from '../types.js';
import type { DebugEvent, EnrichedEvent } from '../../types.js';

// Track request start times for duration calculation
const requestStartTimes = new Map<string, number>();

export class LLMRequestHandler implements IEventHandler {
  type = 'llm.request';

  process(event: DebugEvent): EnrichedEvent {
    const requestId = event.data.requestId as string | undefined;
    if (requestId) {
      requestStartTimes.set(requestId, event.timestamp);
    }
    return { ...event };
  }
}

export class LLMResponseHandler implements IEventHandler {
  type = 'llm.response';

  process(event: DebugEvent): EnrichedEvent {
    const requestId = event.data.requestId as string | undefined;
    let duration: number | undefined;

    if (requestId) {
      const startTime = requestStartTimes.get(requestId);
      if (startTime) {
        duration = event.timestamp - startTime;
        requestStartTimes.delete(requestId);
      }
    }

    // Use durationMs from event data if available
    const durationMs = event.data.durationMs as number | undefined;

    return {
      ...event,
      duration: duration ?? durationMs,
    };
  }
}

export class LLMErrorHandler implements IEventHandler {
  type = 'llm.error';

  process(event: DebugEvent): EnrichedEvent {
    const requestId = event.data.requestId as string | undefined;
    if (requestId) {
      requestStartTimes.delete(requestId);
    }
    return { ...event };
  }
}

export class LLMTokensHandler implements IEventHandler {
  type = 'llm.tokens';

  process(event: DebugEvent): EnrichedEvent {
    return { ...event };
  }

  aggregate(events: DebugEvent[]): Record<string, unknown> {
    let inputTokens = 0;
    let outputTokens = 0;

    for (const event of events) {
      inputTokens += (event.data.inputTokens as number) || 0;
      outputTokens += (event.data.outputTokens as number) || 0;
    }

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }
}

export const llmEventHandlers: IEventHandler[] = [
  new LLMRequestHandler(),
  new LLMResponseHandler(),
  new LLMErrorHandler(),
  new LLMTokensHandler(),
];
