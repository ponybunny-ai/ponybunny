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
  retentionRunsTotal: number;
  retentionDeletedTotal: number;
  retentionFailedTotal: number;
  lastRetentionRunAt?: number;
  sessionFirst: {
    sessionCreationsTotal: number;
    sessionCreationsSucceeded: number;
    sessionCreationSuccessRate: number;
    conversationMessagesTotal: number;
    conversationMessagesSucceeded: number;
    conversationMessagesFailed: number;
    conversationMessageSuccessRate: number;
    goalsTotal: number;
    goalsWithSessionLink: number;
    goalSessionCoverageRate: number;
    runsTotal: number;
    runsSucceeded: number;
    runsFailed: number;
    runSuccessRate: number;
    averageRunLatencyMs: number;
    lastRunCompletedAt?: number;
  };
}

export interface RunEventRetentionTelemetrySample {
  deleted: number;
  ok: boolean;
  timestamp: number;
}

export class RuntimeRolloutTelemetry {
  private dryRunsTotal = 0;
  private dryRunsSucceeded = 0;
  private dryRunsFailed = 0;
  private planStepTotal = 0;
  private changedStepTotal = 0;
  private failureCodeCounts: Record<string, number> = {};
  private lastDryRunAt: number | undefined;
  private retentionRunsTotal = 0;
  private retentionDeletedTotal = 0;
  private retentionFailedTotal = 0;
  private lastRetentionRunAt: number | undefined;
  private sessionCreationsTotal = 0;
  private sessionCreationsSucceeded = 0;
  private conversationMessagesTotal = 0;
  private conversationMessagesSucceeded = 0;
  private conversationMessagesFailed = 0;
  private goalsTotal = 0;
  private goalsWithSessionLink = 0;
  private runsTotal = 0;
  private runsSucceeded = 0;
  private runsFailed = 0;
  private runLatencyMsTotal = 0;
  private runLatencySampleCount = 0;
  private runStartedAtByRunId = new Map<string, number>();
  private lastRunCompletedAt: number | undefined;

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

  recordRetentionRun(sample: RunEventRetentionTelemetrySample): void {
    this.retentionRunsTotal += 1;
    this.retentionDeletedTotal += sample.deleted;
    if (!sample.ok) {
      this.retentionFailedTotal += 1;
    }
    this.lastRetentionRunAt = sample.timestamp;
  }

  recordSessionCreation(sample: { ok: boolean; timestamp: number }): void {
    this.sessionCreationsTotal += 1;
    if (sample.ok) {
      this.sessionCreationsSucceeded += 1;
    }
  }

  recordConversationMessage(sample: { ok: boolean; timestamp: number }): void {
    this.conversationMessagesTotal += 1;
    if (sample.ok) {
      this.conversationMessagesSucceeded += 1;
      return;
    }

    this.conversationMessagesFailed += 1;
  }

  recordGoalSessionCoverage(sample: {
    goalsTotal: number;
    goalsWithSessionLink: number;
  }): void {
    this.goalsTotal = Math.max(0, sample.goalsTotal);
    this.goalsWithSessionLink = Math.max(0, Math.min(sample.goalsWithSessionLink, sample.goalsTotal));
  }

  recordRunStarted(sample: { runId: string; timestamp: number }): void {
    if (!sample.runId) {
      return;
    }

    this.runStartedAtByRunId.set(sample.runId, sample.timestamp);
  }

  recordRunCompleted(sample: {
    runId?: string;
    success?: boolean;
    status?: string;
    timestamp: number;
    timeSeconds?: number;
  }): void {
    this.runsTotal += 1;

    const succeeded = sample.success === true
      || (sample.success === undefined && sample.status === 'success');
    if (succeeded) {
      this.runsSucceeded += 1;
    } else {
      this.runsFailed += 1;
    }

    const latencyFromSeconds = typeof sample.timeSeconds === 'number' && Number.isFinite(sample.timeSeconds)
      ? Math.max(0, sample.timeSeconds * 1000)
      : undefined;
    const startTs = sample.runId ? this.runStartedAtByRunId.get(sample.runId) : undefined;
    const latencyFromEvents = typeof startTs === 'number'
      ? Math.max(0, sample.timestamp - startTs)
      : undefined;
    const latency = latencyFromSeconds ?? latencyFromEvents;

    if (typeof latency === 'number') {
      this.runLatencyMsTotal += latency;
      this.runLatencySampleCount += 1;
    }

    if (sample.runId) {
      this.runStartedAtByRunId.delete(sample.runId);
    }

    this.lastRunCompletedAt = sample.timestamp;
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
    const sessionCreationSuccessRate = this.sessionCreationsTotal > 0
      ? this.sessionCreationsSucceeded / this.sessionCreationsTotal
      : 0;
    const conversationMessageSuccessRate = this.conversationMessagesTotal > 0
      ? this.conversationMessagesSucceeded / this.conversationMessagesTotal
      : 0;
    const goalSessionCoverageRate = this.goalsTotal > 0
      ? this.goalsWithSessionLink / this.goalsTotal
      : 0;
    const runSuccessRate = this.runsTotal > 0
      ? this.runsSucceeded / this.runsTotal
      : 0;
    const averageRunLatencyMs = this.runLatencySampleCount > 0
      ? this.runLatencyMsTotal / this.runLatencySampleCount
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
      retentionRunsTotal: this.retentionRunsTotal,
      retentionDeletedTotal: this.retentionDeletedTotal,
      retentionFailedTotal: this.retentionFailedTotal,
      lastRetentionRunAt: this.lastRetentionRunAt,
      sessionFirst: {
        sessionCreationsTotal: this.sessionCreationsTotal,
        sessionCreationsSucceeded: this.sessionCreationsSucceeded,
        sessionCreationSuccessRate,
        conversationMessagesTotal: this.conversationMessagesTotal,
        conversationMessagesSucceeded: this.conversationMessagesSucceeded,
        conversationMessagesFailed: this.conversationMessagesFailed,
        conversationMessageSuccessRate,
        goalsTotal: this.goalsTotal,
        goalsWithSessionLink: this.goalsWithSessionLink,
        goalSessionCoverageRate,
        runsTotal: this.runsTotal,
        runsSucceeded: this.runsSucceeded,
        runsFailed: this.runsFailed,
        runSuccessRate,
        averageRunLatencyMs,
        lastRunCompletedAt: this.lastRunCompletedAt,
      },
    };
  }
}
