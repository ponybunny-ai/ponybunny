import {
  buildEventedDispatchCheckpoint,
} from '../../src/scheduler/evented-dispatch-checkpoint.js';
import type { InFlightRunReconciliationCandidate } from '../../src/work-order/types/index.js';
import {
  classifyEventedStartupCandidate,
  reconcileEventedStartupCandidates,
} from '../../src/scheduler-daemon/evented-startup-reconciliation.js';

function createCandidate(
  overrides: Partial<InFlightRunReconciliationCandidate> = {}
): InFlightRunReconciliationCandidate {
  return {
    run: {
      id: 'run-1',
      created_at: 1,
      work_item_id: 'wi-1',
      goal_id: 'goal-1',
      agent_type: 'code',
      run_sequence: 1,
      status: 'running',
      tokens_used: 0,
      cost_usd: 0,
      artifacts: [],
      context: {
        evented_dispatch: buildEventedDispatchCheckpoint({
          laneId: 'main',
          dispatchedAt: 1_000,
          resultContinuationApplied: false,
        }),
      },
    },
    workItemStatus: 'in_progress',
    workItemUpdatedAt: 1_000,
    ...overrides,
  };
}

describe('evented startup reconciliation', () => {
  it('classifies recent evented in-flight runs as maybe_reattachable', () => {
    const finding = classifyEventedStartupCandidate(createCandidate(), 20_000, 30_000);
    expect(finding.classification).toBe('maybe_reattachable');
    expect(finding.staleTimeoutExceeded).toBe(false);
  });

  it('classifies stale non-terminal evented runs as likely_orphaned', () => {
    const finding = classifyEventedStartupCandidate(createCandidate(), 90_000, 30_000);
    expect(finding.classification).toBe('likely_orphaned');
    expect(finding.staleTimeoutExceeded).toBe(true);
    expect(finding.ageMs).toBe(89_000);
  });

  it('classifies terminal durable state as already_terminal_in_db', () => {
    const finding = classifyEventedStartupCandidate(
      createCandidate({
        workItemStatus: 'done',
      }),
      90_000,
      30_000
    );
    expect(finding.classification).toBe('already_terminal_in_db');
  });

  it('classifies runs without evented checkpoint as not_evented_candidate', () => {
    const finding = classifyEventedStartupCandidate(
      createCandidate({
        run: {
          ...createCandidate().run,
          context: { selected_model: 'direct-model' },
        },
      }),
      90_000,
      30_000
    );
    expect(finding.classification).toBe('not_evented_candidate');
  });

  it('summarizes reconciliation counts across classifications', () => {
    const summary = reconcileEventedStartupCandidates(
      [
        createCandidate(),
        createCandidate({
          run: {
            ...createCandidate().run,
            id: 'run-2',
            work_item_id: 'wi-2',
            context: {
              evented_dispatch: buildEventedDispatchCheckpoint({
                laneId: 'main',
                dispatchedAt: 1_000,
                resultContinuationApplied: false,
              }),
            },
          },
        }),
        createCandidate({
          run: {
            ...createCandidate().run,
            id: 'run-3',
            work_item_id: 'wi-3',
            context: { selected_model: 'direct-model' },
          },
        }),
      ],
      90_000,
      30_000
    );

    expect(summary.scanned).toBe(3);
    expect(summary.staleTimeoutExceeded).toBe(2);
    expect(summary.byClassification.likely_orphaned).toBe(2);
    expect(summary.byClassification.not_evented_candidate).toBe(1);
  });
});
