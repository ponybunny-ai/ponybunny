import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer tool-provider/runtime ownership split', () => {
  test('GatewayServer delegates tool registry and global provider wiring to the runtime helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');

    expect(source).toContain("from './runtime/gateway-tool-provider-runtime.js'");
    expect(source).toContain('this.toolProviderRuntime = new GatewayToolProviderRuntime(');
    expect(source).toContain('this.toolRegistry = this.toolProviderRuntime.toolRegistry;');
    expect(source).toContain('this.toolAllowlist = this.toolProviderRuntime.toolAllowlist;');
    expect(source).toContain('this.toolEnforcer = this.toolProviderRuntime.toolEnforcer;');
    expect(source).not.toContain('private registerTools(): void {');
    expect(source).not.toContain('new ToolRegistry()');
    expect(source).not.toContain('new ToolAllowlist()');
    expect(source).not.toContain('new ToolEnforcer(this.toolRegistry, this.toolAllowlist)');
    expect(source).not.toContain('setGlobalToolProvider(');
    expect(source).not.toContain('configureLLMProviderManagerStreamEventSink(');
  });
});
