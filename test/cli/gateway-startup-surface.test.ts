import { readFileSync } from 'fs';
import path from 'path';

describe('gateway startup surface split', () => {
  test('gateway CLI routes default runtime assembly through the explicit bootstrap helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/cli/commands/gateway.ts'), 'utf8');

    expect(source).toContain("from '../../gateway/bootstrap/default-gateway-runtime.js'");
    expect(source).toContain('createDefaultGatewayRuntime');
    expect(source).not.toContain("import { GatewayServer, type Permission } from '../../gateway/index.js';");
    expect(source).not.toContain("import { WorkOrderDatabase } from '../../work-order/database/manager.js';");
  });
});
