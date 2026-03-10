import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer startup/runtime ownership split', () => {
  test('GatewayServer delegates startup lifecycle sequencing to the bootstrap helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');

    expect(source).toContain("from './bootstrap/gateway-server-runtime-lifecycle.js'");
    expect(source).toContain('startGatewayServerRuntimeLifecycle(');
    expect(source).toContain('stopGatewayServerRuntimeLifecycle(');
    expect(source).toContain('schedulerSocketPath?: string;');
    expect(source).not.toContain('this.configWatcher.start();');
    expect(source).not.toContain('setupDebugBroadcaster(');
    expect(source).not.toContain('getAsciiArtBanner(');
  });
});
