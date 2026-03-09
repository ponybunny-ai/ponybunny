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
});
