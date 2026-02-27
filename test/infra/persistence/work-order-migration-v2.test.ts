import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-workorder-mig-'));
  return path.join(dir, 'pony.db');
}

describe('WorkOrderDatabase migration v2', () => {
  it('keeps initialize idempotent when allowed_actions already exists', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);

    await repository.initialize();
    await repository.initialize();
    repository.close();

    const db = new Database(dbPath);
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('goals')")
      .all() as Array<{ name: string }>;
    const allowedActionColumns = columns.filter((column) => column.name === 'allowed_actions');

    expect(allowedActionColumns).toHaveLength(1);
    db.close();
  });

  it('persists and reads allowed_actions through repository', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'Goal with allowlist',
      description: 'Ensure allowed_actions persists',
      success_criteria: [],
      allowed_actions: ['read_file', 'search_code'],
    });

    const loaded = repository.getGoal(goal.id);

    expect(loaded).toBeDefined();
    expect(loaded?.allowed_actions).toEqual(['read_file', 'search_code']);

    repository.close();
  });
});
