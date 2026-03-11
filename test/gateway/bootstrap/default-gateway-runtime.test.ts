import { readFileSync } from 'fs';
import path from 'path';

describe('default gateway runtime bootstrap surface', () => {
  test('bootstrap helper centralizes default gateway persistence and runtime assembly', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/gateway/bootstrap/default-gateway-runtime.ts'),
      'utf8'
    );

    expect(source).toContain('export async function createDefaultGatewayPersistence');
    expect(source).toContain('export async function createDefaultGatewayRuntime');
    expect(source).toContain('export async function stopDefaultGatewayRuntime');
    expect(source).toContain("import { GatewayServer } from '../gateway-server.js';");
    expect(source).toContain("import { resolveDefaultGatewaySchedulerSocketPath } from './gateway-server-runtime-lifecycle.js';");
    expect(source).toContain("import { WorkOrderDatabase } from '../../work-order/database/manager.js';");
    expect(source).toContain('schedulerSocketPath: resolveDefaultGatewaySchedulerSocketPath()');
  });
});
