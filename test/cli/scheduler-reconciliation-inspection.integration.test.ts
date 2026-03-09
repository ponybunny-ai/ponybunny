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

async function seedReplayInspectionDb(dbPath: string): Promise<{
  originalRunId: string;
  replacementRunId: string;
  directRunId: string;
}> {
  const repository = new WorkOrderDatabase(dbPath);
  await repository.initialize();

  const goal = repository.createGoal({
    title: 'goal',
    description: 'desc',
    success_criteria: [],
  });

  const replayItem = repository.createWorkItem({
    goal_id: goal.id,
    title: 'replay',
    description: 'desc',
    item_type: 'code',
  });
  repository.updateWorkItemStatus(replayItem.id, 'in_progress');

  const directItem = repository.createWorkItem({
    goal_id: goal.id,
    title: 'direct',
    description: 'desc',
    item_type: 'test',
  });
  repository.updateWorkItemStatus(directItem.id, 'in_progress');

  const originalRun = repository.createRun({
    work_item_id: replayItem.id,
    goal_id: goal.id,
    agent_type: 'code',
    run_sequence: 1,
  });

  const replacementRun = repository.createRun({
    work_item_id: replayItem.id,
    goal_id: goal.id,
    agent_type: 'code',
    run_sequence: 2,
  });
  repository.mergeRunContext(replacementRun.id, {
    evented_dispatch: buildEventedDispatchCheckpoint({
      laneId: 'main',
      dispatchedAt: 2000,
      resultContinuationApplied: false,
      replayOfRunId: originalRun.id,
      replayStartedAt: 2000,
    }),
  });

  repository.mergeRunContext(originalRun.id, {
    evented_dispatch: {
      ...buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 1000,
        resultContinuationApplied: false,
      }),
      orphan_classification: 'stale_timeout',
      orphan_detected_at: 1500,
      recovery_candidate: true,
      recovery_candidate_marked_at: 1600,
      recovery_candidate_reason: 'manual_operator_mark',
      replay_candidate: true,
      replay_candidate_marked_at: 1700,
      replay_candidate_reason: 'manual_operator_mark',
      manual_replay: {
        requested_at: 2000,
        requested_reason: 'manual_operator_request',
        replacement_run_id: replacementRun.id,
        replacement_run_created_at: 2000,
        original_continuation_suppressed_at: 2000,
      },
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
    originalRunId: originalRun.id,
    replacementRunId: replacementRun.id,
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

  test('prints replay lineage fields for an original replayed run', async () => {
    const dbPath = createTempDbPath();
    const { originalRunId, replacementRunId } = await seedReplayInspectionDb(dbPath);

    const output = execSync(`${pbCommand} scheduler inspect-run ${originalRunId} --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    expect(output).toContain(`- runId: ${originalRunId}`);
    expect(output).toContain('- isReplayAttempt: false');
    expect(output).toContain('- replayLineageRole: original');
    expect(output).toContain(`- replayLineagePeerRunId: ${replacementRunId}`);
    expect(output).toContain('- replay_of_run_id: -');
    expect(output).toContain(`- replacement_run_id: ${replacementRunId}`);
    expect(output).toContain('- replay_started_at: -');
    expect(output).toContain('- original_continuation_suppressed_at: 1970-01-01T00:00:02.000Z');
  });

  test('prints replay lineage fields for a replacement replay attempt', async () => {
    const dbPath = createTempDbPath();
    const { originalRunId, replacementRunId } = await seedReplayInspectionDb(dbPath);

    const output = execSync(
      `${pbCommand} scheduler inspect-run ${replacementRunId} --db "${dbPath}"`,
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    );

    expect(output).toContain(`- runId: ${replacementRunId}`);
    expect(output).toContain('- isReplayAttempt: true');
    expect(output).toContain('- replayLineageRole: replacement');
    expect(output).toContain(`- replayLineagePeerRunId: ${originalRunId}`);
    expect(output).toContain(`- replay_of_run_id: ${originalRunId}`);
    expect(output).toContain('- replacement_run_id: -');
    expect(output).toContain('- replay_started_at: 1970-01-01T00:00:02.000Z');
    expect(output).toContain('- original_continuation_suppressed_at: -');
  });

  test('non-replay runs still inspect cleanly and direct mode remains unaffected', async () => {
    const dbPath = createTempDbPath();
    const { directRunId } = await seedReplayInspectionDb(dbPath);

    const output = execSync(`${pbCommand} scheduler inspect-run ${directRunId} --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    expect(output).toContain(`- runId: ${directRunId}`);
    expect(output).toContain('- executionMode: direct');
    expect(output).toContain('- isReplayAttempt: false');
    expect(output).toContain('- replayLineageRole: none');
    expect(output).toContain('- replayLineagePeerRunId: -');
    expect(output).toContain('- replay_of_run_id: -');
    expect(output).toContain('- replacement_run_id: -');
    expect(output).toContain('- replay_started_at: -');
    expect(output).toContain('- original_continuation_suppressed_at: -');
  });

  test('replay-run prints a stable rejection reason and leaves lineage unchanged on rejection', async () => {
    const dbPath = createTempDbPath();
    const { inFlightRunId } = await seedInspectionDb(dbPath);

    execSync(`${pbCommand} scheduler mark-recovery-candidate ${inFlightRunId} --db "${dbPath}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    try {
      execSync(`${pbCommand} scheduler replay-run ${inFlightRunId} --db "${dbPath}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      throw new Error('expected replay-run to fail without replay candidate');
    } catch (error) {
      const execError = error as Error & { stdout?: string };
      expect(execError.stdout).toContain(
        `Could not replay run ${inFlightRunId} (not_evented_execution: scheduler is not running in evented execution mode).`
      );
      expect(execError.stdout).toContain('- replayLineageRole: none');
      expect(execError.stdout).toContain('- replayLineagePeerRunId: -');
      expect(execError.stdout).toContain('- replacement_run_id: -');
    }
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
