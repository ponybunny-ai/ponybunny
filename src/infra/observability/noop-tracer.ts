/**
 * NoopTracer — zero-overhead tracer placeholder.
 *
 * Used as the default tracer when no OTLP endpoint is configured.
 * All operations are no-ops with minimal object allocation.
 */

import type { ITracer, ISpan, SpanAttributes } from './tracer.js';

const NOOP_SPAN: ISpan = {
  setAttributes(_attrs: SpanAttributes): void {},
  addEvent(_name: string, _attrs?: SpanAttributes): void {},
  end(_attrs?: SpanAttributes & { status?: 'ok' | 'error' }): void {},
};

export class NoopTracer implements ITracer {
  startSpan(_name: string, _attrs?: SpanAttributes): ISpan {
    return NOOP_SPAN;
  }

  async withSpan<T>(
    _name: string,
    _attrs: SpanAttributes,
    fn: (span: ISpan) => Promise<T>
  ): Promise<T> {
    return fn(NOOP_SPAN);
  }
}
