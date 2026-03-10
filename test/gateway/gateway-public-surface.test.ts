import { readFileSync } from 'fs';
import path from 'path';

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
});
