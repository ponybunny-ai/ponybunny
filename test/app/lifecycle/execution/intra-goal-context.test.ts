import {
  extractIntraGoalContext,
  formatIntraGoalContext,
  MAX_INTRA_GOAL_ITEMS,
  type IntraGoalContext,
} from '../../../../src/app/lifecycle/execution/intra-goal-context.js';
import type { ContextSnapshot } from '../../../../src/work-order/types/index.js';

function makeSnapshot(overrides: Partial<ContextSnapshot['knowledge_base']> = {}): ContextSnapshot {
  return {
    goal_state: {
      current_work_items: [],
      completed_work_items: [],
      blocked_work_items: [],
      recent_decisions: [],
      active_escalations: [],
    },
    execution_summary: {
      total_runs: 0,
      success_count: 0,
      failure_count: 0,
      most_common_errors: [],
    },
    knowledge_base: {
      learned_patterns: [],
      pitfalls_discovered: [],
      successful_approaches: [],
      ...overrides,
    },
    next_actions: {
      recommended_work_items: [],
      risk_factors: [],
    },
  };
}

describe('extractIntraGoalContext', () => {
  it('returns pitfalls and patterns from snapshot', () => {
    const snapshot = makeSnapshot({
      pitfalls_discovered: ['avoid flaky test X', 'DB locks on concurrent writes'],
      learned_patterns: ['use retry wrapper for network calls'],
    });

    const result = extractIntraGoalContext(snapshot);

    expect(result.pitfalls).toEqual(['avoid flaky test X', 'DB locks on concurrent writes']);
    expect(result.patterns).toEqual(['use retry wrapper for network calls']);
  });

  it('returns empty arrays for empty knowledge base', () => {
    const snapshot = makeSnapshot();

    const result = extractIntraGoalContext(snapshot);

    expect(result.pitfalls).toEqual([]);
    expect(result.patterns).toEqual([]);
  });

  it('gives pitfalls priority over patterns', () => {
    // With maxItems=4, pitfalls get ceil(4/2)=2 budget, patterns get remainder
    const snapshot = makeSnapshot({
      pitfalls_discovered: ['p1', 'p2', 'p3'],
      learned_patterns: ['l1', 'l2', 'l3'],
    });

    const result = extractIntraGoalContext(snapshot, 4);

    // Pitfall budget: ceil(4/2) = 2
    expect(result.pitfalls).toEqual(['p1', 'p2']);
    // Remaining: 4 - 2 = 2
    expect(result.patterns).toEqual(['l1', 'l2']);
  });

  it('enforces MAX_INTRA_GOAL_ITEMS cap', () => {
    const manyPitfalls = Array.from({ length: 20 }, (_, i) => `pitfall-${i}`);
    const manyPatterns = Array.from({ length: 20 }, (_, i) => `pattern-${i}`);
    const snapshot = makeSnapshot({
      pitfalls_discovered: manyPitfalls,
      learned_patterns: manyPatterns,
    });

    const result = extractIntraGoalContext(snapshot);

    const totalItems = result.pitfalls.length + result.patterns.length;
    expect(totalItems).toBeLessThanOrEqual(MAX_INTRA_GOAL_ITEMS);
    // Pitfall budget: ceil(15/2) = 8
    expect(result.pitfalls).toHaveLength(8);
    // Remaining: 15 - 8 = 7
    expect(result.patterns).toHaveLength(7);
  });

  it('fills patterns when pitfalls use less than their budget', () => {
    const snapshot = makeSnapshot({
      pitfalls_discovered: ['only-one'],
      learned_patterns: Array.from({ length: 20 }, (_, i) => `pattern-${i}`),
    });

    const result = extractIntraGoalContext(snapshot);

    expect(result.pitfalls).toEqual(['only-one']);
    // Remaining: 15 - 1 = 14
    expect(result.patterns).toHaveLength(14);
  });

  it('respects custom maxItems parameter', () => {
    const snapshot = makeSnapshot({
      pitfalls_discovered: ['p1', 'p2', 'p3'],
      learned_patterns: ['l1', 'l2', 'l3'],
    });

    const result = extractIntraGoalContext(snapshot, 3);

    // Pitfall budget: ceil(3/2) = 2
    expect(result.pitfalls).toEqual(['p1', 'p2']);
    // Remaining: 3 - 2 = 1
    expect(result.patterns).toEqual(['l1']);
  });
});

describe('formatIntraGoalContext', () => {
  it('returns null for empty context', () => {
    const ctx: IntraGoalContext = { pitfalls: [], patterns: [] };
    expect(formatIntraGoalContext(ctx)).toBeNull();
  });

  it('formats pitfalls with [PITFALL] prefix', () => {
    const ctx: IntraGoalContext = {
      pitfalls: ['avoid X'],
      patterns: [],
    };

    const result = formatIntraGoalContext(ctx);

    expect(result).not.toBeNull();
    expect(result).toContain('- [PITFALL] avoid X');
    expect(result).toContain('DISCOVERIES FROM EARLIER STEPS IN THIS GOAL:');
  });

  it('formats patterns with [PATTERN] prefix', () => {
    const ctx: IntraGoalContext = {
      pitfalls: [],
      patterns: ['use retry wrapper'],
    };

    const result = formatIntraGoalContext(ctx);

    expect(result).not.toBeNull();
    expect(result).toContain('- [PATTERN] use retry wrapper');
  });

  it('formats mixed pitfalls and patterns', () => {
    const ctx: IntraGoalContext = {
      pitfalls: ['avoid X', 'watch out for Y'],
      patterns: ['always do Z'],
    };

    const result = formatIntraGoalContext(ctx)!;

    expect(result).toContain('DISCOVERIES FROM EARLIER STEPS IN THIS GOAL:');
    expect(result).toContain('- [PITFALL] avoid X');
    expect(result).toContain('- [PITFALL] watch out for Y');
    expect(result).toContain('- [PATTERN] always do Z');
    expect(result).toContain('(These were found during execution of preceding work items in this goal.)');
  });

  it('lists pitfalls before patterns', () => {
    const ctx: IntraGoalContext = {
      pitfalls: ['pitfall-line'],
      patterns: ['pattern-line'],
    };

    const result = formatIntraGoalContext(ctx)!;
    const pitfallIndex = result.indexOf('[PITFALL]');
    const patternIndex = result.indexOf('[PATTERN]');

    expect(pitfallIndex).toBeLessThan(patternIndex);
  });
});
