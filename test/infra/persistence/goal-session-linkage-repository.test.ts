import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-goal-session-'));
  return path.join(dir, 'goals.db');
}

describe('WorkOrderDatabase goal session linkage queries', () => {
  let dbPath: string;
  let repository: WorkOrderDatabase;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
  });

  afterEach(() => {
    repository.close();
  });

  it('filters goals by context.sessionId', () => {
    repository.createGoal({
      title: 'g1',
      description: 'session one',
      success_criteria: [],
      context: {
        createdViaConversation: true,
        sessionId: 'ses-1',
        turnId: 'turn-1',
      },
    });

    repository.createGoal({
      title: 'g2',
      description: 'session two',
      success_criteria: [],
      context: {
        createdViaConversation: true,
        sessionId: 'ses-2',
        turnId: 'turn-2',
      },
    });

    const sessionOneGoals = repository.listGoals({ session_id: 'ses-1' });
    expect(sessionOneGoals).toHaveLength(1);
    expect(sessionOneGoals[0].context?.sessionId).toBe('ses-1');
    expect(sessionOneGoals[0].context?.turnId).toBe('turn-1');
  });
});
