import { execSync } from 'child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WorkOrderDatabase } from '../../src/infra/persistence/work-order-repository.js';
import { buildEventedDispatchCheckpoint } from '../../src/scheduler/evented-dispatch-checkpoint.js';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-cli-reconcile-'));
  return path.join(dir, 'pony.db');
}

async function seedInspectionDb(dbPath: string): Promise<{
  inFlightRunId: string;
  orphanedRunId: string;
}> {
  const repository = new WorkOrderDatabase(dbPath);
  await repository.initialize();

  const goal = repository.createGoal({
    title: 'goal',
    description: 'desc',
    success_criteria: [],
  });

  const inFlightItem = repository.createWorkItem({
    goal_id: goal.id,
    title: 'in-flight',
    description: 'desc',
    item_type: 'code',
  });
  repository.updateWorkItemStatus(inFlightItem.id, 'in_progress');

  const orphanedItem = repository.createWorkItem({
    goal_id: goal.id,
    title: 'orphaned',
    description: 'desc',
    item_type: 'code',
  });
  repository.updateWorkItemStatus(orphanedItem.id, 'in_progress');

  const directItem = repository.createWorkItem({
    goal_id: goal.id,
    title: 'direct',
    description: 'desc',
    item_type: 'test',
  });
  repository.updateWorkItemStatus(directItem.id, 'in_progress');

  const inFlightRun = repository.createRun({
    work_item_id: inFlightItem.id,
    goal_id: goal.id,
    agent_type: 'code',
    run_sequence: 1,
  });
  repository.mergeRunContext(inFlightRun.id, {
    evented_dispatch: buildEventedDispatchCheckpoint({
      laneId: 'main',
      dispatchedAt: 1000,
      resultContinuationApplied: false,
    }),
  });

  const orphanedRun = repository.createRun({
    work_item_id: orphanedItem.id,
    goal_id: goal.id,
    agent_type: 'code',
    run_sequence: 1,
  });
  repository.mergeRunContext(orphanedRun.id, {
    evented_dispatch: {
      ...buildEventedDispatchCheckpoint({
        laneId: 'slow',
        dispatchedAt: 2000,
        resultContinuationApplied: false,
      }),
      orphan_classification: 'stale_timeout',
      orphan_detected_at: 2500,
    },
  });

  repository.createRun({
    work_item_id: directItem.id,
    goal_id: goal.id,
    agent_type: 'test',
    run_sequence: 1,
    context: { selected_model: 'direct-model' },
  });

  repository.close();

  return {
    inFlightRunId: inFlightRun.id,
    orphanedRunId: orphanedRun.id,
  };
}

describe('pb scheduler reconciliation inspection', () => {
  const pbCommand = 'node dist/cli/index.js';

  beforeAll(() => {
    execSync('npm run build:cli', { cwd: process.cwd(), stdio: 'pipe' });
  });

  test('prints evented in-flight inspection rows', async () => {
    const dbPath = createTempDbPath();
    const { inFlightRunId, orphanedRunId } = await seedInspectionDb(dbPath);

    const output = execSync(`${pbCommand} scheduler in-flight --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    expect(output).toContain('Evented In-Flight Runs');
    expect(output).toContain(`runId=${inFlightRunId}`);
    expect(output).toContain(`runId=${orphanedRunId}`);
    expect(output).toContain('executionMode=evented');
    expect(output).toContain('resultContinuationApplied=false');
    expect(output).toContain('orphanClassification=stale_timeout');
    expect(output).not.toContain('direct-model');
  });

  test('prints the reconciliation summary counts', async () => {
    const dbPath = createTempDbPath();
    await seedInspectionDb(dbPath);

    const output = execSync(`${pbCommand} scheduler reconciliation-summary --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    expect(output).toContain('Evented Reconciliation Summary');
    expect(output).toContain('in_flight_evented: 2');
    expect(output).toContain('stale_orphaned: 1');
    expect(output).toContain('continuation_applied: 0');
    expect(output).toContain('already_terminal: 0');
  });
});
