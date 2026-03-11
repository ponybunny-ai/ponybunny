import { readFileSync } from 'fs';
import path from 'path';

describe('gateway server runtime lifecycle bootstrap helper', () => {
  test('centralizes startup-only sequencing outside GatewayServer', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts'),
      'utf8'
    );

    expect(source).toContain('export async function startGatewayServerRuntimeLifecycle');
    expect(source).toContain('export async function stopGatewayServerRuntimeLifecycle');
    expect(source).toContain('export function resolveDefaultGatewaySchedulerSocketPath');
    expect(source).toContain("source: 'gateway-startup'");
    expect(source).toContain("source: 'gateway-stop'");
  });
});
