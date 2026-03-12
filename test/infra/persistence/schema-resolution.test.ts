import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('persistence schema resolution', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('initializes WorkOrderDatabase outside the repository cwd', async () => {
    const isolatedCwd = createTempDir('pony-schema-cwd-');
    const dbPath = path.join(isolatedCwd, 'pony.db');
    process.chdir(isolatedCwd);

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(repository.listGoals()).toEqual([]);

    repository.close();
  });
});
