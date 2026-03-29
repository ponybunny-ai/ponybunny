/**
 * Structured Logger Interface + Implementations
 *
 * ILogger is the constructor-injectable interface all services should depend on.
 * Implementations:
 *   - JsonLogger: writes one JSON object per line to a writable stream (stdout by default)
 *   - NoopLogger: zero-overhead silent logger for tests
 *
 * The interface is designed to be compatible with pino's API so that
 * a PinoLogger adapter can be introduced later without changing callers.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  goalId?: string;
  workItemId?: string;
  runId?: string;
  sessionId?: string;
  agentType?: string;
  model?: string;
  endpointId?: string;
  event?: string;
  [key: string]: unknown;
}

export interface ILogger {
  debug(ctx: LogContext, msg: string): void;
  info(ctx: LogContext, msg: string): void;
  warn(ctx: LogContext, msg: string): void;
  error(ctx: LogContext, msg: string, err?: Error): void;
  /** Create a child logger with permanently bound context fields. */
  child(bindCtx: LogContext): ILogger;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface JsonLoggerOptions {
  /** Minimum level to emit. Default: 'info' */
  level?: LogLevel;
  /** Writable stream for output. Default: process.stdout */
  output?: { write(s: string): boolean };
}

/**
 * JSON Lines structured logger.
 *
 * Each log entry is a single JSON object terminated by newline.
 * Output format:
 *   {"level":"info","time":1711699200000,"goalId":"g-123","event":"tick","msg":"Started"}
 */
export class JsonLogger implements ILogger {
  private readonly minPriority: number;
  private readonly output: { write(s: string): boolean };
  private readonly boundCtx: LogContext;

  constructor(options: JsonLoggerOptions = {}, boundCtx: LogContext = {}) {
    this.minPriority = LOG_LEVEL_PRIORITY[options.level ?? 'info'];
    this.output = options.output ?? process.stdout;
    this.boundCtx = boundCtx;
  }

  debug(ctx: LogContext, msg: string): void {
    this.emit('debug', ctx, msg);
  }

  info(ctx: LogContext, msg: string): void {
    this.emit('info', ctx, msg);
  }

  warn(ctx: LogContext, msg: string): void {
    this.emit('warn', ctx, msg);
  }

  error(ctx: LogContext, msg: string, err?: Error): void {
    const errCtx = err
      ? { ...ctx, error: err.message, stack: err.stack }
      : ctx;
    this.emit('error', errCtx, msg);
  }

  child(bindCtx: LogContext): ILogger {
    return new JsonLogger(
      {
        level: this.levelFromPriority(),
        output: this.output,
      },
      { ...this.boundCtx, ...bindCtx }
    );
  }

  private emit(level: LogLevel, ctx: LogContext, msg: string): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minPriority) return;

    const entry = {
      level,
      time: Date.now(),
      ...this.boundCtx,
      ...ctx,
      msg,
    };

    this.output.write(JSON.stringify(entry) + '\n');
  }

  private levelFromPriority(): LogLevel {
    for (const [lvl, priority] of Object.entries(LOG_LEVEL_PRIORITY)) {
      if (priority === this.minPriority) return lvl as LogLevel;
    }
    return 'info';
  }
}

/**
 * Silent logger with zero overhead. Use in tests and non-observable code paths.
 */
export class NoopLogger implements ILogger {
  debug(_ctx: LogContext, _msg: string): void {}
  info(_ctx: LogContext, _msg: string): void {}
  warn(_ctx: LogContext, _msg: string): void {}
  error(_ctx: LogContext, _msg: string, _err?: Error): void {}
  child(_bindCtx: LogContext): ILogger {
    return this;
  }
}
