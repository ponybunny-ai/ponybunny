import { NoopTracer } from '../../../src/infra/observability/noop-tracer.js';
import type { ITracer, ISpan } from '../../../src/infra/observability/tracer.js';

describe('NoopTracer', () => {
  let tracer: ITracer;

  beforeEach(() => {
    tracer = new NoopTracer();
  });

  it('returns a span from startSpan', () => {
    const span = tracer.startSpan('test.operation', { key: 'value' });
    expect(span).toBeDefined();
    expect(typeof span.setAttributes).toBe('function');
    expect(typeof span.addEvent).toBe('function');
    expect(typeof span.end).toBe('function');
  });

  it('span methods are no-ops', () => {
    const span = tracer.startSpan('test');
    // None of these should throw
    span.setAttributes({ foo: 'bar', count: 42, flag: true });
    span.addEvent('event_name', { detail: 'value' });
    span.end({ status: 'ok' });
  });

  it('withSpan executes the function and returns its result', async () => {
    const result = await tracer.withSpan('test', {}, async (span: ISpan) => {
      span.addEvent('inside');
      return 42;
    });
    expect(result).toBe(42);
  });

  it('withSpan propagates errors', async () => {
    await expect(
      tracer.withSpan('test', {}, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('returns the same singleton span', () => {
    const span1 = tracer.startSpan('a');
    const span2 = tracer.startSpan('b');
    expect(span1).toBe(span2);
  });
});
