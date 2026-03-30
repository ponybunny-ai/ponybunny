import type { ContextSnapshot } from '../../../work-order/types/index.js';

export const MAX_INTRA_GOAL_ITEMS = 15;

export interface IntraGoalContext {
  pitfalls: string[];
  patterns: string[];
}

/**
 * Extract discoveries from a ContextPack's knowledge_base for injection
 * into subsequent WorkItem execution prompts.
 *
 * Pure function — no async, no LLM, no side effects.
 *
 * Prioritizes pitfalls (most actionable), then patterns.
 * Total items capped at MAX_INTRA_GOAL_ITEMS.
 */
export function extractIntraGoalContext(
  snapshot: ContextSnapshot,
  maxItems: number = MAX_INTRA_GOAL_ITEMS,
): IntraGoalContext {
  const kb = snapshot.knowledge_base;

  // Pitfalls get priority — up to half the budget
  const pitfallBudget = Math.ceil(maxItems / 2);
  const pitfalls = kb.pitfalls_discovered.slice(0, pitfallBudget);

  // Patterns fill the remainder
  const remaining = maxItems - pitfalls.length;
  const patterns = kb.learned_patterns.slice(0, remaining);

  return { pitfalls, patterns };
}

/**
 * Format intra-goal context as a prompt section for injection into
 * execution system prompts.
 */
export function formatIntraGoalContext(ctx: IntraGoalContext): string | null {
  if (ctx.pitfalls.length === 0 && ctx.patterns.length === 0) {
    return null;
  }

  const lines: string[] = [
    'DISCOVERIES FROM EARLIER STEPS IN THIS GOAL:',
  ];

  for (const p of ctx.pitfalls) {
    lines.push(`- [PITFALL] ${p}`);
  }
  for (const p of ctx.patterns) {
    lines.push(`- [PATTERN] ${p}`);
  }

  lines.push('(These were found during execution of preceding work items in this goal.)');

  return lines.join('\n');
}
