import { readFileSync } from 'fs';
import path from 'path';
import { isGatewayCompatibilityEventType } from '../../src/gateway/types.js';

describe('gateway public surface split', () => {
  test('historical mixed gateway barrel delegates through explicit live and compatibility entrypoints', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/index.ts'), 'utf8');

    expect(source).toContain("export * from './public.js';");
    expect(source).toContain("export * from './compatibility.js';");
  });

  test('live public gateway surface routes integration exports through live boundaries only', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/public.ts'), 'utf8');

    expect(source).toContain("from './integration/boundaries.js'");
    expect(source).not.toContain("from './integration/compatibility.js'");
  });

  test('gateway compatibility barrel centralizes compatibility-only exports', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/compatibility.ts'), 'utf8');

    expect(source).toContain("from './integration/compatibility.js'");
    expect(source).not.toContain("from './integration/boundaries.js'");
  });

  test('legacy task.* event helpers stay on the compatibility surface only', () => {
    const publicSource = readFileSync(path.join(process.cwd(), 'src/gateway/public.ts'), 'utf8');
    const compatibilitySource = readFileSync(path.join(process.cwd(), 'src/gateway/compatibility.ts'), 'utf8');

    expect(isGatewayCompatibilityEventType('task.narration')).toBe(true);
    expect(isGatewayCompatibilityEventType('task.result')).toBe(true);
    expect(isGatewayCompatibilityEventType('run.completed')).toBe(false);
    expect(publicSource).not.toContain('isGatewayCompatibilityEventType');
    expect(compatibilitySource).toContain('isGatewayCompatibilityEventType');
  });
});
