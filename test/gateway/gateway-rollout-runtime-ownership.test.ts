import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer rollout/runtime ownership split', () => {
  test('GatewayServer delegates rollout telemetry and rollback coordination to the runtime helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');

    expect(source).toContain("from './runtime/gateway-runtime-rollout-coordinator.js'");
    expect(source).toContain('this.runtimeRolloutCoordinator = new GatewayRuntimeRolloutCoordinator(');
    expect(source).toContain('getRuntimeRolloutMetrics: () => this.runtimeRolloutCoordinator.getMetricsSnapshot()');
    expect(source).toContain('onDryRunComplete: (sample) => this.runtimeRolloutCoordinator.handleDryRunComplete(sample)');
    expect(source).not.toContain('private async rollbackRuntimeRolloutOnFailure(): Promise<void>');
    expect(source).not.toContain('private async evaluateRolloutThresholds(): Promise<void>');
  });
});
