import { RuntimeRolloutTelemetry } from '../../../src/gateway/runtime/runtime-rollout-telemetry.js';

describe('RuntimeRolloutTelemetry', () => {
  it('aggregates dry run counters and averages', () => {
    const telemetry = new RuntimeRolloutTelemetry();

    telemetry.recordDryRun({
      ok: true,
      planStepCount: 4,
      changedStepCount: 1,
      compileErrorCodes: [],
      timestamp: 1700000000000,
    });
    telemetry.recordDryRun({
      ok: false,
      planStepCount: 6,
      changedStepCount: 3,
      compileErrorCodes: ['ERR_TOOL_NOT_FOUND', 'ERR_TOOL_NOT_FOUND'],
      timestamp: 1700000001000,
    });

    const snapshot = telemetry.snapshot();
    expect(snapshot).toEqual({
      dryRunsTotal: 2,
      dryRunsSucceeded: 1,
      dryRunsFailed: 1,
      successRate: 0.5,
      averagePlanStepCount: 5,
      averageChangedStepCount: 2,
      failureCodeCounts: {
        ERR_TOOL_NOT_FOUND: 2,
      },
      lastDryRunAt: 1700000001000,
      retentionRunsTotal: 0,
      retentionDeletedTotal: 0,
      retentionFailedTotal: 0,
    });
  });

  it('falls back to UNKNOWN failure code for failed dry runs without compile codes', () => {
    const telemetry = new RuntimeRolloutTelemetry();

    telemetry.recordDryRun({
      ok: false,
      planStepCount: 3,
      changedStepCount: 1,
      compileErrorCodes: [],
      timestamp: 1700000002000,
    });

    const snapshot = telemetry.snapshot();
    expect(snapshot.failureCodeCounts).toEqual({
      UNKNOWN: 1,
    });
  });

  it('aggregates run-event retention telemetry', () => {
    const telemetry = new RuntimeRolloutTelemetry();

    telemetry.recordRetentionRun({ deleted: 7, ok: true, timestamp: 1700000003000 });
    telemetry.recordRetentionRun({ deleted: 2, ok: false, timestamp: 1700000004000 });

    const snapshot = telemetry.snapshot();
    expect(snapshot.retentionRunsTotal).toBe(2);
    expect(snapshot.retentionDeletedTotal).toBe(9);
    expect(snapshot.retentionFailedTotal).toBe(1);
    expect(snapshot.lastRetentionRunAt).toBe(1700000004000);
  });
});
