import { JsonLogger, NoopLogger } from '../../../src/infra/observability/logger.js';
import type { ILogger } from '../../../src/infra/observability/logger.js';

describe('JsonLogger', () => {
  let output: string[];
  let writer: { write(s: string): boolean };

  beforeEach(() => {
    output = [];
    writer = {
      write(s: string): boolean {
        output.push(s.trim());
        return true;
      },
    };
  });

  it('writes JSON Lines format', () => {
    const logger = new JsonLogger({ output: writer });
    logger.info({ event: 'tick' }, 'Started');

    expect(output).toHaveLength(1);
    const entry = JSON.parse(output[0]);
    expect(entry.level).toBe('info');
    expect(entry.event).toBe('tick');
    expect(entry.msg).toBe('Started');
    expect(entry.time).toBeGreaterThan(0);
  });

  it('filters by log level', () => {
    const logger = new JsonLogger({ level: 'warn', output: writer });

    logger.debug({}, 'Debug');
    logger.info({}, 'Info');
    logger.warn({}, 'Warn');
    logger.error({}, 'Error');

    expect(output).toHaveLength(2);
    expect(JSON.parse(output[0]).level).toBe('warn');
    expect(JSON.parse(output[1]).level).toBe('error');
  });

  it('includes error details in error level', () => {
    const logger = new JsonLogger({ output: writer });
    const err = new Error('something broke');

    logger.error({}, 'Failed', err);

    const entry = JSON.parse(output[0]);
    expect(entry.error).toBe('something broke');
    expect(entry.stack).toContain('Error: something broke');
  });

  it('merges bound context in child loggers', () => {
    const logger = new JsonLogger({ output: writer });
    const child = logger.child({ goalId: 'g-1', sessionId: 's-1' });

    child.info({ event: 'step' }, 'Doing work');

    const entry = JSON.parse(output[0]);
    expect(entry.goalId).toBe('g-1');
    expect(entry.sessionId).toBe('s-1');
    expect(entry.event).toBe('step');
  });

  it('call context overrides bound context', () => {
    const logger = new JsonLogger({ output: writer });
    const child = logger.child({ goalId: 'g-1' });

    child.info({ goalId: 'g-override' }, 'Override');

    const entry = JSON.parse(output[0]);
    expect(entry.goalId).toBe('g-override');
  });

  it('child preserves parent log level', () => {
    const logger = new JsonLogger({ level: 'error', output: writer });
    const child = logger.child({ goalId: 'g-1' });

    child.info({}, 'Should not appear');
    child.error({}, 'Should appear');

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]).level).toBe('error');
  });

  it('handles debug level', () => {
    const logger = new JsonLogger({ level: 'debug', output: writer });
    logger.debug({ event: 'trace' }, 'Debug message');

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]).level).toBe('debug');
  });
});

describe('NoopLogger', () => {
  it('implements ILogger', () => {
    const logger: ILogger = new NoopLogger();

    // Should not throw
    logger.debug({}, 'test');
    logger.info({}, 'test');
    logger.warn({}, 'test');
    logger.error({}, 'test', new Error('test'));
  });

  it('child returns itself', () => {
    const logger = new NoopLogger();
    const child = logger.child({ goalId: 'g-1' });
    expect(child).toBe(logger);
  });
});
