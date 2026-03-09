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
  directRunId: string;
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

  const directRun = repository.createRun({
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
    directRunId: directRun.id,
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

  test('prints one inspected run with durable recovery fields', async () => {
    const dbPath = createTempDbPath();
    const { orphanedRunId } = await seedInspectionDb(dbPath);

    const output = execSync(`${pbCommand} scheduler inspect-run ${orphanedRunId} --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    expect(output).toContain('Run Inspection');
    expect(output).toContain(`- runId: ${orphanedRunId}`);
    expect(output).toContain('- executionMode: evented');
    expect(output).toContain('- lane: slow');
    expect(output).toContain('- resultContinuationApplied: false');
    expect(output).toContain('- orphanClassification: stale_timeout');
    expect(output).toContain('- recoveryCandidate: -');
    expect(output).toContain('- replayCandidate: -');
  });

  test('marks an evented run as a recovery candidate idempotently without affecting direct runs', async () => {
    const dbPath = createTempDbPath();
    const { inFlightRunId, directRunId } = await seedInspectionDb(dbPath);

    const firstOutput = execSync(
      `${pbCommand} scheduler mark-recovery-candidate ${inFlightRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    expect(firstOutput).toContain(`Recovery candidate marked for run ${inFlightRunId}.`);
    expect(firstOutput).toContain('- recoveryCandidate: true');
    expect(firstOutput).toContain('- recoveryCandidateReason: manual_operator_mark');

    const secondOutput = execSync(
      `${pbCommand} scheduler mark-recovery-candidate ${inFlightRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    expect(secondOutput).toContain(`Recovery candidate already marked for run ${inFlightRunId}.`);

    try {
      execSync(`${pbCommand} scheduler mark-recovery-candidate ${directRunId} --db "${dbPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      throw new Error('expected direct run mark to fail');
    } catch (error) {
      const execError = error as Error & { stdout?: string };
      expect(execError.stdout).toContain(
        `Could not mark run ${directRunId} as a recovery candidate (missing_evented_dispatch).`
      );
    }
  });

  test('marks an evented recovery candidate as a replay candidate idempotently without affecting direct runs', async () => {
    const dbPath = createTempDbPath();
    const { inFlightRunId, directRunId } = await seedInspectionDb(dbPath);

    try {
      execSync(`${pbCommand} scheduler mark-replay-candidate ${inFlightRunId} --db "${dbPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      throw new Error('expected replay mark without recovery candidate to fail');
    } catch (error) {
      const execError = error as Error & { stdout?: string };
      expect(execError.stdout).toContain(
        `Could not mark run ${inFlightRunId} as a replay candidate (recovery_candidate_required).`
      );
    }

    execSync(`${pbCommand} scheduler mark-recovery-candidate ${inFlightRunId} --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const firstOutput = execSync(
      `${pbCommand} scheduler mark-replay-candidate ${inFlightRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    expect(firstOutput).toContain(`Replay candidate marked for run ${inFlightRunId}.`);
    expect(firstOutput).toContain('- replayCandidate: true');
    expect(firstOutput).toContain('- replayCandidateReason: manual_operator_mark');

    const secondOutput = execSync(
      `${pbCommand} scheduler mark-replay-candidate ${inFlightRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    expect(secondOutput).toContain(`Replay candidate already marked for run ${inFlightRunId}.`);

    try {
      execSync(`${pbCommand} scheduler mark-replay-candidate ${directRunId} --db "${dbPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      throw new Error('expected direct replay mark to fail');
    } catch (error) {
      const execError = error as Error & { stdout?: string };
      expect(execError.stdout).toContain(
        `Could not mark run ${directRunId} as a replay candidate (missing_evented_dispatch).`
      );
    }
  });

  test('clears an evented run recovery candidate idempotently and leaves direct mode unaffected', async () => {
    const dbPath = createTempDbPath();
    const { inFlightRunId, directRunId } = await seedInspectionDb(dbPath);

    execSync(`${pbCommand} scheduler mark-recovery-candidate ${inFlightRunId} --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const firstOutput = execSync(
      `${pbCommand} scheduler clear-recovery-candidate ${inFlightRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    expect(firstOutput).toContain(`Recovery candidate cleared for run ${inFlightRunId}.`);
    expect(firstOutput).toContain('- recoveryCandidate: false');
    expect(firstOutput).toContain('- recoveryCandidateMarkedAt:');
    expect(firstOutput).toContain('- recoveryCandidateReason: manual_operator_mark');

    const secondOutput = execSync(
      `${pbCommand} scheduler clear-recovery-candidate ${inFlightRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );
    expect(secondOutput).toContain(`Recovery candidate already cleared for run ${inFlightRunId}.`);
    expect(secondOutput).toContain('- recoveryCandidate: false');

    try {
      execSync(`${pbCommand} scheduler clear-recovery-candidate ${directRunId} --db "${dbPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      throw new Error('expected direct run clear to fail');
    } catch (error) {
      const execError = error as Error & { stdout?: string };
      expect(execError.stdout).toContain(
        `Could not clear recovery candidate for run ${directRunId} (missing_evented_dispatch).`
      );
    }
  });
});
