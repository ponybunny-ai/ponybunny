import type { WorkItem } from '../../work-order/types/index.js';

export interface AgentTickWorkItemContext {
  kind: 'agent_tick';
  agent_id: string;
  definition_hash: string;
  run_key: string;
  scheduled_for_ms: number;
  policy_snapshot: Record<string, unknown> | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasString = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'string';

const hasNumber = (value: Record<string, unknown>, key: string): boolean =>
  typeof value[key] === 'number' && Number.isFinite(value[key]);

export const isAgentTickContext = (context: unknown): context is AgentTickWorkItemContext => {
  if (!isRecord(context)) {
    return false;
  }

  if (context.kind !== 'agent_tick') {
    return false;
  }

  if (!hasString(context, 'agent_id')) {
    return false;
  }

  if (!hasString(context, 'definition_hash')) {
    return false;
  }

  if (!hasString(context, 'run_key')) {
    return false;
  }

  if (!hasNumber(context, 'scheduled_for_ms')) {
    return false;
  }

  const policySnapshot = context.policy_snapshot;
  if (policySnapshot !== null && policySnapshot !== undefined && !isRecord(policySnapshot)) {
    return false;
  }

  return true;
};

export const getAgentTickContext = (workItem: WorkItem): AgentTickWorkItemContext | null => {
  return isAgentTickContext(workItem.context) ? workItem.context : null;
};
