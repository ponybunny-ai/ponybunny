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
});
