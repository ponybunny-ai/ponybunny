export interface RuntimeDryRunTelemetrySample {
  ok: boolean;
  planStepCount: number;
  changedStepCount: number;
  compileErrorCodes: string[];
  timestamp: number;
}

export interface RuntimeRolloutMetricsSnapshot {
  dryRunsTotal: number;
  dryRunsSucceeded: number;
  dryRunsFailed: number;
  successRate: number;
  averagePlanStepCount: number;
  averageChangedStepCount: number;
  failureCodeCounts: Record<string, number>;
  lastDryRunAt?: number;
}

export class RuntimeRolloutTelemetry {
  private dryRunsTotal = 0;
  private dryRunsSucceeded = 0;
  private dryRunsFailed = 0;
  private planStepTotal = 0;
  private changedStepTotal = 0;
  private failureCodeCounts: Record<string, number> = {};
  private lastDryRunAt: number | undefined;

  recordDryRun(sample: RuntimeDryRunTelemetrySample): void {
    this.dryRunsTotal += 1;
    this.planStepTotal += sample.planStepCount;
    this.changedStepTotal += sample.changedStepCount;
    this.lastDryRunAt = sample.timestamp;

    if (sample.ok) {
      this.dryRunsSucceeded += 1;
      return;
    }

    this.dryRunsFailed += 1;
    const codes = sample.compileErrorCodes.length > 0 ? sample.compileErrorCodes : ['UNKNOWN'];
    for (const code of codes) {
      this.failureCodeCounts[code] = (this.failureCodeCounts[code] ?? 0) + 1;
    }
  }

  snapshot(): RuntimeRolloutMetricsSnapshot {
    const averagePlanStepCount = this.dryRunsTotal > 0
      ? this.planStepTotal / this.dryRunsTotal
      : 0;
    const averageChangedStepCount = this.dryRunsTotal > 0
      ? this.changedStepTotal / this.dryRunsTotal
      : 0;
    const successRate = this.dryRunsTotal > 0
      ? this.dryRunsSucceeded / this.dryRunsTotal
      : 0;

    return {
      dryRunsTotal: this.dryRunsTotal,
      dryRunsSucceeded: this.dryRunsSucceeded,
      dryRunsFailed: this.dryRunsFailed,
      successRate,
      averagePlanStepCount,
      averageChangedStepCount,
      failureCodeCounts: { ...this.failureCodeCounts },
      lastDryRunAt: this.lastDryRunAt,
    };
  }
}
