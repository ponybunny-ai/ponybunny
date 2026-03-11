import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer tool-provider/runtime ownership split', () => {
  test('GatewayServer delegates tool-provider assembly and publication wiring to the runtime helper cluster', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');
    const helperSource = readFileSync(
      path.join(process.cwd(), 'src/gateway/runtime/gateway-tool-provider-runtime-cluster.ts'),
      'utf8'
    );

    expect(source).toContain("from './runtime/gateway-tool-provider-runtime-cluster.js'");
    expect(source).toContain('const toolProviderRuntimeCluster = createGatewayToolProviderRuntimeCluster(');
    expect(source).toContain('this.toolProviderRuntime = toolProviderRuntimeCluster.toolProviderRuntime;');
    expect(source).toContain('this.runtimeRpcSurface = toolProviderRuntimeCluster.runtimeRpcSurface;');
    expect(source).not.toContain('private registerTools(): void {');
    expect(source).not.toContain('private toolRegistry:');
    expect(source).not.toContain('private toolAllowlist:');
    expect(source).not.toContain('private toolEnforcer:');
    expect(source).not.toContain('new ToolRegistry()');
    expect(source).not.toContain('new ToolAllowlist()');
    expect(source).not.toContain('this.toolRegistry =');
    expect(source).not.toContain('this.toolAllowlist =');
    expect(source).not.toContain('this.toolEnforcer =');
    expect(helperSource).toContain("from './gateway-tool-provider-runtime.js'");
    expect(helperSource).toContain("from './gateway-runtime-rpc-surface.js'");
    expect(helperSource).toContain('const toolProviderRuntime = new GatewayToolProviderRuntime(');
    expect(helperSource).toContain('toolRegistry: toolProviderRuntime.toolRegistry,');
  });
});
