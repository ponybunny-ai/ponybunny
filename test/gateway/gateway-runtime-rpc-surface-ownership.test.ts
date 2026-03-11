import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer runtime-rpc/control-plane ownership split', () => {
  test('GatewayServer delegates runtime-rpc surface assembly away from the live server while the surface keeps handler ownership', () => {
    const gatewaySource = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');
    const helperSource = readFileSync(
      path.join(process.cwd(), 'src/gateway/runtime/gateway-tool-provider-runtime-cluster.ts'),
      'utf8'
    );
    const runtimeSurfaceSource = readFileSync(
      path.join(process.cwd(), 'src/gateway/runtime/gateway-runtime-rpc-surface.ts'),
      'utf8'
    );

    expect(gatewaySource).toContain("from './runtime/gateway-tool-provider-runtime-cluster.js'");
    expect(gatewaySource).toContain('this.runtimeRpcSurface = toolProviderRuntimeCluster.runtimeRpcSurface;');
    expect(gatewaySource).toContain('this.runtimeRpcSurface.register();');
    expect(gatewaySource).toContain('return this.runtimeRpcSurface.getGatewayStatusSnapshot();');
    expect(gatewaySource).not.toContain('registerSystemHandlers(');
    expect(gatewaySource).not.toContain('registerInternalRuntimeHandlers(');
    expect(gatewaySource).not.toContain('new GatewayRuntimeRpcSurface(');

    expect(helperSource).toContain('new GatewayRuntimeRpcSurface(');
    expect(runtimeSurfaceSource).toContain("from '../rpc/handlers/system-handlers.js'");
    expect(runtimeSurfaceSource).toContain("from '../rpc/handlers/internal-runtime-handlers.js'");
    expect(runtimeSurfaceSource).toContain('registerSystemHandlers(');
    expect(runtimeSurfaceSource).toContain('registerInternalRuntimeHandlers(');
  });
});
