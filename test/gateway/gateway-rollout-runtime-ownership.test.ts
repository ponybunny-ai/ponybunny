import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer rollout/runtime ownership split', () => {
  test('GatewayServer delegates rollout telemetry and rollback coordination to the runtime helper', () => {
    const gatewaySource = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');
    const runtimeRpcSurfaceSource = readFileSync(
      path.join(process.cwd(), 'src/gateway/runtime/gateway-runtime-rpc-surface.ts'),
      'utf8'
    );

    expect(gatewaySource).toContain("from './runtime/gateway-runtime-rollout-coordinator.js'");
    expect(gatewaySource).toContain('this.runtimeRolloutCoordinator = new GatewayRuntimeRolloutCoordinator(');
    expect(gatewaySource).not.toContain('private async rollbackRuntimeRolloutOnFailure(): Promise<void>');
    expect(gatewaySource).not.toContain('private async evaluateRolloutThresholds(): Promise<void>');

    expect(runtimeRpcSurfaceSource).toContain('getRuntimeRolloutMetrics: () => this.runtimeRolloutCoordinator.getMetricsSnapshot()');
    expect(runtimeRpcSurfaceSource).toContain('onDryRunComplete: (sample) => this.runtimeRolloutCoordinator.handleDryRunComplete(sample)');
  });
});
