/**
 * Audit Action Naming Convention Utility (ADR-002 Phase F1)
 *
 * Defines a source-prefixed naming convention for audit actions:
 *   user.goal.submit      - user-initiated via RPC
 *   system.workitem.retry  - scheduler automatic retry
 *   agent.tool.call        - agent tool invocation
 *
 * This utility enables gradual migration to prefixed naming without
 * breaking existing audit data. The original {entity}.{verb} actions
 * in AuditAction remain unchanged; new code can adopt prefixed names
 * via PREFIXED_ACTIONS constants or the prefixedAction() builder.
 *
 * The ActorType -> AuditSourcePrefix mapping collapses the finer-grained
 * actor types (daemon, scheduler, gateway) into 'system' for action naming,
 * since the actor_type field already preserves the specific origin.
 */

import type { ActorType } from './types.js';

// ============================================================================
// Source Prefix Type
// ============================================================================

export type AuditSourcePrefix = 'user' | 'system' | 'agent';

// ============================================================================
// Prefix Builder
// ============================================================================

/**
 * Constructs a source-prefixed audit action name.
 *
 * @example
 *   prefixedAction('user', 'goal', 'submit')   // 'user.goal.submit'
 *   prefixedAction('system', 'budget', 'exceeded') // 'system.budget.exceeded'
 *   prefixedAction('agent', 'tool', 'call')     // 'agent.tool.call'
 */
export function prefixedAction(source: AuditSourcePrefix, entity: string, verb: string): string {
  return `${source}.${entity}.${verb}`;
}

// ============================================================================
// ActorType -> AuditSourcePrefix Mapping
// ============================================================================

/**
 * Maps an ActorType to its corresponding AuditSourcePrefix.
 *
 * The finer-grained system actor types (daemon, scheduler, gateway) all
 * collapse to 'system' for action naming purposes. The original actor_type
 * field on the audit log entry preserves the specific origin.
 */
export function actorTypeToSource(actorType: ActorType): AuditSourcePrefix {
  switch (actorType) {
    case 'user': return 'user';
    case 'agent': return 'agent';
    case 'system':
    case 'daemon':
    case 'scheduler':
    case 'gateway':
      return 'system';
  }
}

// ============================================================================
// Common Prefixed Action Constants
// ============================================================================

/**
 * Well-known prefixed audit action names for use in new code.
 *
 * These do NOT replace existing AuditAction values. They are intended
 * for new audit points that adopt the prefixed convention from the start,
 * or for gradual migration of existing action names.
 */
export const PREFIXED_ACTIONS = {
  // User-initiated
  USER_GOAL_SUBMIT: 'user.goal.submit',
  USER_GOAL_CANCEL: 'user.goal.cancel',
  USER_PERMISSION_GRANT: 'user.permission.grant',
  USER_PERMISSION_DENY: 'user.permission.deny',
  USER_ESCALATION_RESOLVE: 'user.escalation.resolve',
  USER_PLAN_APPROVE: 'user.plan.approve',
  USER_PLAN_REJECT: 'user.plan.reject',

  // System-initiated
  SYSTEM_WORKITEM_RETRY: 'system.workitem.retry',
  SYSTEM_BUDGET_EXCEEDED: 'system.budget.exceeded',
  SYSTEM_GOAL_EVALUATED: 'system.goal.evaluated',
  SYSTEM_CIRCUIT_OPENED: 'system.circuit.opened',

  // Agent-initiated
  AGENT_TOOL_CALL: 'agent.tool.call',
  AGENT_TOOL_COMPLETE: 'agent.tool.complete',
  AGENT_DECISION_RECORDED: 'agent.decision.recorded',
} as const;

export type PrefixedActionValue = typeof PREFIXED_ACTIONS[keyof typeof PREFIXED_ACTIONS];

// ============================================================================
// Validation Helpers
// ============================================================================

const VALID_PREFIXES: ReadonlySet<string> = new Set<AuditSourcePrefix>(['user', 'system', 'agent']);

/**
 * Checks whether a string starts with a valid source prefix (user./system./agent.).
 */
export function hasPrefixedFormat(action: string): boolean {
  const firstDot = action.indexOf('.');
  if (firstDot === -1) return false;
  return VALID_PREFIXES.has(action.slice(0, firstDot));
}
