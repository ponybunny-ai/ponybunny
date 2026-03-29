/**
 * RuntimeEventTracer -- writes spans to the runtime_events table.
 *
 * Maps span data onto the runtime_events schema:
 *   id            -> randomUUID()
 *   type          -> 'span'
 *   source        -> span name
 *   timestamp     -> span start time (ms)
 *   work_item_id  -> from span attributes (if present)
 *   goal_id       -> from span attributes (if present)
 *   run_id        -> from span attributes (if present)
 *   payload_json  -> JSON with { attributes, events, start_ms, end_ms, duration_ms, status }
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ITracer, ISpan, SpanAttributes } from './tracer.js';
import type { ILogger } from './logger.js';

interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

interface SpanPayload {
  attributes: SpanAttributes;
  events: SpanEvent[];
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  status: 'ok' | 'error';
}

class RuntimeEventSpan implements ISpan {
  private readonly id: string;
  private readonly name: string;
  private readonly startMs: number;
  private readonly attributes: SpanAttributes;
  private readonly events: SpanEvent[] = [];
  private readonly logger: ILogger | undefined;
  private readonly insert: Database.Statement;
  private ended = false;

  constructor(
    name: string,
    attrs: SpanAttributes | undefined,
    insert: Database.Statement,
    logger?: ILogger,
  ) {
    this.id = randomUUID();
    this.name = name;
    this.startMs = Date.now();
    this.attributes = { ...attrs };
    this.insert = insert;
    this.logger = logger;
  }

  setAttributes(attrs: SpanAttributes): void {
    Object.assign(this.attributes, attrs);
  }

  addEvent(name: string, attrs?: SpanAttributes): void {
    this.events.push({ name, timestamp: Date.now(), attributes: attrs });
  }

  end(attrs?: SpanAttributes & { status?: 'ok' | 'error' }): void {
    if (this.ended) return;
    this.ended = true;

    if (attrs) {
      const { status: _status, ...rest } = attrs;
      Object.assign(this.attributes, rest);
    }

    const endMs = Date.now();
    const status = attrs?.status ?? 'ok';

    const payload: SpanPayload = {
      attributes: this.attributes,
      events: this.events,
      start_ms: this.startMs,
      end_ms: endMs,
      duration_ms: endMs - this.startMs,
      status,
    };

    try {
      this.insert.run(
        this.id,
        'span',
        (this.attributes.workItemId as string) ?? null,
        (this.attributes.goalId as string) ?? null,
        (this.attributes.runId as string) ?? null,
        this.name,
        this.startMs,
        JSON.stringify(payload),
      );
    } catch (err) {
      this.logger?.error(
        { event: 'runtime_event_tracer.write_failed', spanName: this.name },
        `Failed to write span to runtime_events: ${err}`,
        err instanceof Error ? err : undefined,
      );
    }
  }
}

export class RuntimeEventTracer implements ITracer {
  private readonly logger: ILogger | undefined;
  private readonly insertStmt: Database.Statement;

  constructor(db: Database.Database, logger?: ILogger) {
    this.logger = logger;
    this.insertStmt = db.prepare(`
      INSERT INTO runtime_events (id, type, work_item_id, goal_id, run_id, source, timestamp, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  startSpan(name: string, attrs?: SpanAttributes): ISpan {
    return new RuntimeEventSpan(name, attrs, this.insertStmt, this.logger);
  }

  async withSpan<T>(
    name: string,
    attrs: SpanAttributes,
    fn: (span: ISpan) => Promise<T>,
  ): Promise<T> {
    const span = this.startSpan(name, attrs);
    try {
      const result = await fn(span);
      span.end({ status: 'ok' });
      return result;
    } catch (err) {
      span.end({ status: 'error' });
      throw err;
    }
  }
}
