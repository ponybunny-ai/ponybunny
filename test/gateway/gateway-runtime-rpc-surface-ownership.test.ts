import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer runtime-rpc/control-plane ownership split', () => {
  test('GatewayServer delegates system and internal runtime handler wiring to the runtime RPC surface', () => {
    const gatewaySource = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');
    const runtimeSurfaceSource = readFileSync(
      path.join(process.cwd(), 'src/gateway/runtime/gateway-runtime-rpc-surface.ts'),
      'utf8'
    );

    expect(gatewaySource).toContain("from './runtime/gateway-runtime-rpc-surface.js'");
    expect(gatewaySource).toContain('this.runtimeRpcSurface = new GatewayRuntimeRpcSurface(');
    expect(gatewaySource).toContain('this.runtimeRpcSurface.register();');
    expect(gatewaySource).toContain('return this.runtimeRpcSurface.getGatewayStatusSnapshot();');
    expect(gatewaySource).not.toContain('registerSystemHandlers(');
    expect(gatewaySource).not.toContain('registerInternalRuntimeHandlers(');

    expect(runtimeSurfaceSource).toContain("from '../rpc/handlers/system-handlers.js'");
    expect(runtimeSurfaceSource).toContain("from '../rpc/handlers/internal-runtime-handlers.js'");
    expect(runtimeSurfaceSource).toContain('registerSystemHandlers(');
    expect(runtimeSurfaceSource).toContain('registerInternalRuntimeHandlers(');
  });
});
