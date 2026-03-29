/**
 * Metrics Recorder Interface.
 *
 * Provides counters (cross-restart cumulative), histograms (latency distribution),
 * and gauges (instantaneous values).
 *
 * Implementations:
 *   - NoopMetricsRecorder: zero-overhead placeholder
 *   - SQLiteMetricsRecorder: persists to metric_counters / metric_samples tables
 */

export type MetricName =
  | 'goal.completed'
  | 'goal.failed'
  | 'workitem.completed'
  | 'workitem.failed'
  | 'run.success'
  | 'run.failure'
  | 'llm.call.duration'
  | 'llm.call.tokens'
  | 'llm.call.cost_usd'
  | 'tool.execution.duration'
  | 'quality_gate.passed'
  | 'quality_gate.failed'
  | 'escalation.created'
  | 'circuit_breaker.opened'
  | 'retry.attempted'
  | 'ipc.message.dropped'
  | string; // Allow custom metric names

export interface IMetricsRecorder {
  /** Increment a counter (persisted across restarts). */
  increment(name: MetricName, labels?: Record<string, string>): void;
  /** Record a duration sample (for histograms/percentiles). */
  recordDuration(name: MetricName, durationMs: number, labels?: Record<string, string>): void;
  /** Set a gauge value (instantaneous, not cumulative). */
  gauge(name: MetricName, value: number, labels?: Record<string, string>): void;
}

/**
 * Silent metrics recorder for tests and non-observable code paths.
 */
export class NoopMetricsRecorder implements IMetricsRecorder {
  increment(_name: MetricName, _labels?: Record<string, string>): void {}
  recordDuration(_name: MetricName, _durationMs: number, _labels?: Record<string, string>): void {}
  gauge(_name: MetricName, _value: number, _labels?: Record<string, string>): void {}
}
