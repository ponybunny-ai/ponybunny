/**
 * Tracer Interface for distributed tracing.
 *
 * Implementations:
 *   - NoopTracer: zero-overhead placeholder (default)
 *   - RuntimeEventTracer: writes spans to runtime_events table (lightweight)
 *   - OTLPTracer: exports to Jaeger/Tempo/Honeycomb via OpenTelemetry (production)
 */

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface ISpan {
  setAttributes(attrs: SpanAttributes): void;
  addEvent(name: string, attrs?: SpanAttributes): void;
  end(attrs?: SpanAttributes & { status?: 'ok' | 'error' }): void;
}

export interface ITracer {
  startSpan(name: string, attrs?: SpanAttributes): ISpan;
  /** Run a function within a span, auto-ending on completion or error. */
  withSpan<T>(name: string, attrs: SpanAttributes, fn: (span: ISpan) => Promise<T>): Promise<T>;
}
