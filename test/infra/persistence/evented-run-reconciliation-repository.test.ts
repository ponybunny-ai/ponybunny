import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';
import { buildEventedDispatchCheckpoint } from '../../../src/scheduler/evented-dispatch-checkpoint.js';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-evented-reconcile-'));
  return path.join(dir, 'pony.db');
}

describe('WorkOrderDatabase evented reconciliation queries', () => {
  it('stores a durable evented dispatch checkpoint on the run context', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
      context: { selected_model: 'test-model' },
    });

    repository.mergeRunContext(run.id, {
      evented_dispatch: buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 1234,
        resultContinuationApplied: false,
      }),
    });

    const persisted = repository.getRun(run.id);
    expect(persisted?.context).toEqual(
      expect.objectContaining({
        selected_model: 'test-model',
        evented_dispatch: expect.objectContaining({
          execution_mode: 'evented',
          lane_id: 'main',
          dispatched_at: 1234,
          result_continuation_applied: false,
        }),
      })
    );

    repository.close();
  });

  it('lists running reconciliation candidates with durable work item state', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const eventedItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'evented',
      description: 'desc',
      item_type: 'code',
    });
    const directItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'direct',
      description: 'desc',
      item_type: 'test',
    });

    repository.updateWorkItemStatus(eventedItem.id, 'in_progress');
    repository.updateWorkItemStatus(directItem.id, 'done');

    const eventedRun = repository.createRun({
      work_item_id: eventedItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(eventedRun.id, {
      evented_dispatch: buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 5000,
        resultContinuationApplied: false,
      }),
    });

    repository.createRun({
      work_item_id: directItem.id,
      goal_id: goal.id,
      agent_type: 'test',
      run_sequence: 1,
      context: { selected_model: 'direct-model' },
    });

    const candidates = repository.listInFlightRunReconciliationCandidates();
    expect(candidates).toHaveLength(2);

    const persistedEvented = candidates.find((candidate) => candidate.run.id === eventedRun.id);
    expect(persistedEvented).toEqual(
      expect.objectContaining({
        workItemStatus: 'in_progress',
        run: expect.objectContaining({
          work_item_id: eventedItem.id,
          context: expect.objectContaining({
            evented_dispatch: expect.objectContaining({
              execution_mode: 'evented',
            }),
          }),
        }),
      })
    );

    const persistedDirect = candidates.find((candidate) => candidate.run.work_item_id === directItem.id);
    expect(persistedDirect?.workItemStatus).toBe('done');

    repository.close();
  });

  it('claims evented result continuation durably only once', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });

    repository.mergeRunContext(run.id, {
      evented_dispatch: buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 1234,
        resultContinuationApplied: false,
      }),
    });

    const firstClaim = repository.claimEventedResultContinuation(run.id, 5678);
    expect(firstClaim.status).toBe('claimed');
    expect(firstClaim.run?.context).toEqual(
      expect.objectContaining({
        evented_dispatch: expect.objectContaining({
          result_continuation_applied: true,
          result_continuation_applied_at: 5678,
        }),
      })
    );

    const duplicateClaim = repository.claimEventedResultContinuation(run.id, 9999);
    expect(duplicateClaim.status).toBe('already_applied');
    expect(duplicateClaim.run?.context).toEqual(
      expect.objectContaining({
        evented_dispatch: expect.objectContaining({
          result_continuation_applied: true,
          result_continuation_applied_at: 5678,
        }),
      })
    );

    repository.close();
  });

  it('marks stale evented runs durably only once', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });

    repository.mergeRunContext(run.id, {
      evented_dispatch: buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 1234,
        resultContinuationApplied: false,
      }),
    });

    const firstMark = repository.markEventedRunOrphaned(run.id, {
      classification: 'stale_timeout',
      detectedAt: 5678,
    });
    expect(firstMark.status).toBe('marked');
    expect(firstMark.run?.context).toEqual(
      expect.objectContaining({
        evented_dispatch: expect.objectContaining({
          orphan_classification: 'stale_timeout',
          orphan_detected_at: 5678,
        }),
      })
    );

    const duplicateMark = repository.markEventedRunOrphaned(run.id, {
      classification: 'stale_timeout',
      detectedAt: 9999,
    });
    expect(duplicateMark.status).toBe('already_marked');
    expect(duplicateMark.run?.context).toEqual(
      expect.objectContaining({
        evented_dispatch: expect.objectContaining({
          orphan_classification: 'stale_timeout',
          orphan_detected_at: 5678,
        }),
      })
    );

    repository.close();
  });

  it('inspects one run and marks recovery and replay candidates idempotently without affecting direct runs', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });

    const eventedItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'evented',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(eventedItem.id, 'in_progress');

    const directItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'direct',
      description: 'desc',
      item_type: 'test',
    });
    repository.updateWorkItemStatus(directItem.id, 'in_progress');

    const eventedRun = repository.createRun({
      work_item_id: eventedItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(eventedRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        orphan_detected_at: 1500,
      },
    });

    const directRun = repository.createRun({
      work_item_id: directItem.id,
      goal_id: goal.id,
      agent_type: 'test',
      run_sequence: 1,
      context: {
        selected_model: 'direct-model',
      },
    });

    const eventedInspection = repository.getRunInspection(eventedRun.id);
    expect(eventedInspection).toEqual(
      expect.objectContaining({
        executionMode: 'evented',
        workItemStatus: 'in_progress',
        laneId: 'main',
        dispatchedAt: 1234,
        orphanClassification: 'stale_timeout',
        orphanDetectedAt: 1500,
        recoveryCandidate: undefined,
        replayCandidate: undefined,
      })
    );

    const directInspection = repository.getRunInspection(directRun.id);
    expect(directInspection).toEqual(
      expect.objectContaining({
        executionMode: 'direct',
        workItemStatus: 'in_progress',
        dispatchedAt: undefined,
        recoveryCandidate: undefined,
        replayCandidate: undefined,
      })
    );

    const replayBeforeRecovery = repository.markEventedRunReplayCandidate(eventedRun.id, {
      markedAt: 5555,
    });
    expect(replayBeforeRecovery.status).toBe('recovery_candidate_required');

    const firstMark = repository.markEventedRunRecoveryCandidate(eventedRun.id, {
      markedAt: 5678,
    });
    expect(firstMark).toEqual(
      expect.objectContaining({
        status: 'marked',
        markedAt: 5678,
        reason: 'manual_operator_mark',
      })
    );

    const secondMark = repository.markEventedRunRecoveryCandidate(eventedRun.id, {
      markedAt: 9999,
    });
    expect(secondMark).toEqual(
      expect.objectContaining({
        status: 'already_marked',
        markedAt: 5678,
        reason: 'manual_operator_mark',
      })
    );

    const firstReplayMark = repository.markEventedRunReplayCandidate(eventedRun.id, {
      markedAt: 6789,
    });
    expect(firstReplayMark).toEqual(
      expect.objectContaining({
        status: 'marked',
        markedAt: 6789,
        reason: 'manual_operator_mark',
      })
    );

    const secondReplayMark = repository.markEventedRunReplayCandidate(eventedRun.id, {
      markedAt: 9998,
    });
    expect(secondReplayMark).toEqual(
      expect.objectContaining({
        status: 'already_marked',
        markedAt: 6789,
        reason: 'manual_operator_mark',
      })
    );

    const markedInspection = repository.getRunInspection(eventedRun.id);
    expect(markedInspection).toEqual(
      expect.objectContaining({
        executionMode: 'evented',
        recoveryCandidate: true,
        recoveryCandidateMarkedAt: 5678,
        recoveryCandidateReason: 'manual_operator_mark',
        replayCandidate: true,
        replayCandidateMarkedAt: 6789,
        replayCandidateReason: 'manual_operator_mark',
      })
    );

    const firstClear = repository.clearEventedRunRecoveryCandidate(eventedRun.id);
    expect(firstClear.status).toBe('cleared');

    const secondClear = repository.clearEventedRunRecoveryCandidate(eventedRun.id);
    expect(secondClear.status).toBe('already_cleared');

    const clearedInspection = repository.getRunInspection(eventedRun.id);
    expect(clearedInspection).toEqual(
      expect.objectContaining({
        executionMode: 'evented',
        recoveryCandidate: false,
        recoveryCandidateMarkedAt: 5678,
        recoveryCandidateReason: 'manual_operator_mark',
      })
    );

    const directMark = repository.markEventedRunRecoveryCandidate(directRun.id, {
      markedAt: 8888,
    });
    expect(directMark.status).toBe('missing_evented_dispatch');

    const directReplayMark = repository.markEventedRunReplayCandidate(directRun.id, {
      markedAt: 9999,
    });
    expect(directReplayMark.status).toBe('missing_evented_dispatch');

    const directClear = repository.clearEventedRunRecoveryCandidate(directRun.id);
    expect(directClear.status).toBe('missing_evented_dispatch');

    const persistedDirectRun = repository.getRun(directRun.id);
    expect(persistedDirectRun?.context).toEqual(
      expect.objectContaining({
        selected_model: 'direct-model',
      })
    );
    expect(persistedDirectRun?.context?.evented_dispatch).toBeUndefined();

    repository.close();
  });

  it('lists evented inspection records and summary without including direct runs', async () => {
    const dbPath = createTempDbPath();
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

    const appliedItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'applied',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(appliedItem.id, 'in_progress');

    const terminalItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'terminal',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(terminalItem.id, 'failed');

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
        orphan_detected_at: 3000,
      },
    });

    const appliedRun = repository.createRun({
      work_item_id: appliedItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(appliedRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 4000,
          resultContinuationApplied: false,
        }),
        result_continuation_applied: true,
        result_continuation_applied_at: 4500,
      },
    });

    const terminalRun = repository.createRun({
      work_item_id: terminalItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(terminalRun.id, {
      evented_dispatch: buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 5000,
        resultContinuationApplied: false,
      }),
    });
    repository.completeRun(terminalRun.id, {
      status: 'failure',
      error_message: 'boom',
      tokens_used: 0,
      time_seconds: 0,
      cost_usd: 0,
      artifacts: [],
    });

    const directRun = repository.createRun({
      work_item_id: directItem.id,
      goal_id: goal.id,
      agent_type: 'test',
      run_sequence: 1,
      context: {
        selected_model: 'direct-model',
      },
    });
    expect(directRun.context?.evented_dispatch).toBeUndefined();

    const inFlight = repository.listEventedInFlightRunInspections();
    expect(inFlight.map((record) => record.run.id)).toEqual([inFlightRun.id, orphanedRun.id]);
    expect(inFlight[0]).toEqual(
      expect.objectContaining({
        executionMode: 'evented',
        laneId: 'main',
        dispatchedAt: 1000,
        resultContinuationApplied: false,
        orphanClassification: undefined,
      })
    );
    expect(inFlight[1]).toEqual(
      expect.objectContaining({
        laneId: 'slow',
        orphanClassification: 'stale_timeout',
        orphanDetectedAt: 3000,
        recoveryCandidate: undefined,
      })
    );

    const orphaned = repository.listEventedOrphanedRunInspections();
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.run.id).toBe(orphanedRun.id);

    const summary = repository.getEventedRunReconciliationSummary();
    expect(summary).toEqual({
      inFlightEvented: 2,
      staleOrphaned: 1,
      continuationApplied: 1,
      alreadyTerminal: 1,
    });

    repository.close();
  });

  it('starts one manual replay by suppressing the original run before creating one replacement run', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
      context: { selected_model: 'test-model' },
    });
    repository.mergeRunContext(run.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
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
      },
    });

    const result = repository.startEventedManualReplay(run.id, { requestedAt: 2000 });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'replay_started',
        requestedAt: 2000,
        replacementRun: expect.objectContaining({
          run_sequence: 2,
          work_item_id: workItem.id,
        }),
      })
    );

    const replayedOriginal = repository.getRun(run.id);
    expect(replayedOriginal?.context?.evented_dispatch).toEqual(
      expect.objectContaining({
        manual_replay: expect.objectContaining({
          requested_at: 2000,
          requested_reason: 'manual_operator_request',
          replacement_run_id: result.replacementRun?.id,
          replacement_run_created_at: 2000,
          original_continuation_suppressed_at: 2000,
        }),
      })
    );

    const replacement = repository.getRun(result.replacementRun!.id);
    expect(replacement?.context?.evented_dispatch).toEqual(
      expect.objectContaining({
        replay_of_run_id: run.id,
        replay_started_at: 2000,
      })
    );

    const originalInspection = repository.getRunInspection(run.id);
    expect(originalInspection).toEqual(
      expect.objectContaining({
        executionMode: 'evented',
        replayReplacementRunId: result.replacementRun?.id,
        replayRequestedAt: 2000,
        replaySuppressedAt: 2000,
        replayOfRunId: undefined,
        replayStartedAt: undefined,
      })
    );

    const replacementInspection = repository.getRunInspection(result.replacementRun!.id);
    expect(replacementInspection).toEqual(
      expect.objectContaining({
        executionMode: 'evented',
        replayReplacementRunId: undefined,
        replayRequestedAt: undefined,
        replaySuppressedAt: undefined,
        replayOfRunId: run.id,
        replayStartedAt: 2000,
      })
    );

    const suppressedClaim = repository.claimEventedResultContinuation(run.id, 3000);
    expect(suppressedClaim.status).toBe('suppressed_by_replay');

    repository.close();
  });

  it('prechecks an eligible replay without mutating durable run state', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(run.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
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
      },
    });

    const beforeInspection = repository.getRunInspection(run.id);
    const beforeRuns = repository.getRunsByWorkItem(workItem.id);

    const result = repository.precheckEventedManualReplay(run.id);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'eligible',
        eligible: true,
        rejectionReasons: [],
        expectedConsequences: expect.arrayContaining([
          'original run continuation will be durably suppressed before replay dispatch',
          'a replacement run will be created on the same work item',
          'the replacement run will be linked to the original run',
          'the replacement run will be dispatched through the existing evented path',
        ]),
      })
    );
    expect(repository.getRunInspection(run.id)).toEqual(beforeInspection);
    expect(repository.getRunsByWorkItem(workItem.id)).toEqual(beforeRuns);

    repository.close();
  });

  it('rejects replay when the target run fails the conservative gate set', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(run.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        recovery_candidate: true,
      },
    });

    const result = repository.startEventedManualReplay(run.id, { requestedAt: 2000 });
    expect(result.status).toBe('replay_candidate_required');
    expect(repository.getRunsByWorkItem(workItem.id)).toHaveLength(1);

    repository.close();
  });

  it('prechecks an ineligible replay with the same stable rejection code used by replay', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(run.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        recovery_candidate: true,
      },
    });

    const result = repository.precheckEventedManualReplay(run.id);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'replay_candidate_required',
        eligible: false,
        rejectionReasons: ['replay_candidate_required'],
        expectedConsequences: [],
      })
    );
    expect(repository.getRunsByWorkItem(workItem.id)).toHaveLength(1);

    repository.close();
  });

  it('rejects replay when the recovery candidate marker is missing', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(run.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        replay_candidate: true,
        replay_candidate_marked_at: 1700,
        replay_candidate_reason: 'manual_operator_mark',
      },
    });

    const result = repository.startEventedManualReplay(run.id, { requestedAt: 2000 });
    expect(result.status).toBe('recovery_candidate_required');
    expect(repository.getRunsByWorkItem(workItem.id)).toHaveLength(1);
    expect(repository.getRunInspection(run.id)).toEqual(
      expect.objectContaining({
        replayReplacementRunId: undefined,
        replayOfRunId: undefined,
      })
    );

    repository.close();
  });

  it('rejects replay when durable reverse lineage already exists for the original run', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const originalRun = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(originalRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
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
      },
    });

    const replacementRun = repository.createRun({
      work_item_id: workItem.id,
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

    const result = repository.startEventedManualReplay(originalRun.id, { requestedAt: 3000 });
    expect(result.status).toBe('already_replayed');
    expect(repository.getRunsByWorkItem(workItem.id)).toHaveLength(2);
    expect(repository.getRunInspection(originalRun.id)).toEqual(
      expect.objectContaining({
        replayReplacementRunId: undefined,
      })
    );
    expect(repository.getRunInspection(replacementRun.id)).toEqual(
      expect.objectContaining({
        replayOfRunId: originalRun.id,
      })
    );

    repository.close();
  });

  it('rejects repeated replay requests once an original run has already been replayed', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const run = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(run.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        recovery_candidate: true,
        recovery_candidate_marked_at: 1600,
        recovery_candidate_reason: 'manual_operator_mark',
        replay_candidate: true,
        replay_candidate_marked_at: 1700,
        replay_candidate_reason: 'manual_operator_mark',
      },
    });

    const firstReplay = repository.startEventedManualReplay(run.id, { requestedAt: 2000 });
    expect(firstReplay.status).toBe('replay_started');

    const secondReplay = repository.startEventedManualReplay(run.id, { requestedAt: 3000 });
    expect(secondReplay.status).toBe('already_replayed');
    expect(repository.getRunsByWorkItem(workItem.id)).toHaveLength(2);
    expect(repository.getRunInspection(run.id)).toEqual(
      expect.objectContaining({
        replayReplacementRunId: firstReplay.replacementRun?.id,
      })
    );

    repository.close();
  });

  it('rejects replay attempts that target a replay run directly', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });
    const workItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'work',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(workItem.id, 'in_progress');

    const originalRun = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    const replayRun = repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 2,
    });
    repository.mergeRunContext(replayRun.id, {
      evented_dispatch: buildEventedDispatchCheckpoint({
        laneId: 'main',
        dispatchedAt: 2000,
        resultContinuationApplied: false,
        orphanClassification: 'stale_timeout',
        recoveryCandidate: true,
        replayCandidate: true,
        replayOfRunId: originalRun.id,
        replayStartedAt: 2000,
      }),
    });

    const result = repository.startEventedManualReplay(replayRun.id, { requestedAt: 3000 });
    expect(result.status).toBe('replay_attempt_not_allowed');
    expect(repository.getRunsByWorkItem(workItem.id)).toHaveLength(2);

    repository.close();
  });

  it('rejects terminal and otherwise ineligible replay targets without creating replacement runs', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const goal = repository.createGoal({
      title: 'goal',
      description: 'desc',
      success_criteria: [],
    });

    const alreadyTerminalItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'terminal',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(alreadyTerminalItem.id, 'in_progress');
    const alreadyTerminalRun = repository.createRun({
      work_item_id: alreadyTerminalItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(alreadyTerminalRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        recovery_candidate: true,
        replay_candidate: true,
      },
    });
    repository.completeRun(alreadyTerminalRun.id, {
      status: 'success',
      tokens_used: 0,
      time_seconds: 0,
      cost_usd: 0,
      artifacts: [],
    });

    const completedWorkItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'done-item',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(completedWorkItem.id, 'in_progress');
    const completedWorkItemRun = repository.createRun({
      work_item_id: completedWorkItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(completedWorkItemRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        orphan_classification: 'stale_timeout',
        recovery_candidate: true,
        replay_candidate: true,
      },
    });
    repository.updateWorkItemStatus(completedWorkItem.id, 'done');

    const alreadyAppliedItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'already-applied',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(alreadyAppliedItem.id, 'in_progress');
    const alreadyAppliedRun = repository.createRun({
      work_item_id: alreadyAppliedItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(alreadyAppliedRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: true,
          resultContinuationAppliedAt: 1400,
        }),
        orphan_classification: 'stale_timeout',
        recovery_candidate: true,
        replay_candidate: true,
      },
    });

    const missingOrphanItem = repository.createWorkItem({
      goal_id: goal.id,
      title: 'missing-orphan',
      description: 'desc',
      item_type: 'code',
    });
    repository.updateWorkItemStatus(missingOrphanItem.id, 'in_progress');
    const missingOrphanRun = repository.createRun({
      work_item_id: missingOrphanItem.id,
      goal_id: goal.id,
      agent_type: 'code',
      run_sequence: 1,
    });
    repository.mergeRunContext(missingOrphanRun.id, {
      evented_dispatch: {
        ...buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1234,
          resultContinuationApplied: false,
        }),
        recovery_candidate: true,
        replay_candidate: true,
      },
    });

    expect(repository.startEventedManualReplay(alreadyTerminalRun.id, { requestedAt: 2000 }).status).toBe(
      'already_terminal'
    );
    expect(
      repository.startEventedManualReplay(completedWorkItemRun.id, { requestedAt: 2000 }).status
    ).toBe('work_item_not_in_progress');
    expect(repository.startEventedManualReplay(alreadyAppliedRun.id, { requestedAt: 2000 }).status).toBe(
      'already_applied'
    );
    expect(repository.startEventedManualReplay(missingOrphanRun.id, { requestedAt: 2000 }).status).toBe(
      'missing_orphan_classification'
    );

    expect(repository.getRunsByWorkItem(alreadyTerminalItem.id)).toHaveLength(1);
    expect(repository.getRunsByWorkItem(completedWorkItem.id)).toHaveLength(1);
    expect(repository.getRunsByWorkItem(alreadyAppliedItem.id)).toHaveLength(1);
    expect(repository.getRunsByWorkItem(missingOrphanItem.id)).toHaveLength(1);

    repository.close();
  });
});
