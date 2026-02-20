import type { WorkItem } from '../../work-order/types/index.js';
import type { RouteContext } from '../routing/route-context.js';
import { normalizeRouteContext } from '../routing/route-context.js';

export interface AgentTickWorkItemContext {
  kind: 'agent_tick';
  agent_id: string;
  definition_hash: string;
  run_key: string;
  scheduled_for_ms: number;
  policy_snapshot: Record<string, unknown> | null;
  routeContext?: RouteContext;
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

  const routeContext = context.routeContext ?? context.route_context;
  if (routeContext !== null && routeContext !== undefined && normalizeRouteContext(routeContext) === undefined) {
    return false;
  }

  return true;
};

export const getAgentTickContext = (workItem: WorkItem): AgentTickWorkItemContext | null => {
  if (!isAgentTickContext(workItem.context)) {
    return null;
  }

  const rawContext = workItem.context as unknown as {
    routeContext?: unknown;
    route_context?: unknown;
  };

  const normalizedRouteContext = normalizeRouteContext(
    rawContext.routeContext ?? rawContext.route_context
  );

  return {
    ...workItem.context,
    ...(normalizedRouteContext ? { routeContext: normalizedRouteContext } : {}),
  };
};
