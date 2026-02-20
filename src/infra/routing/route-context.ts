export interface RouteContext {
  source: string;
  providerId?: string;
  accountId?: string;
  channel?: string;
  agentId?: string;
  senderId?: string;
  sessionKey?: string;
  mainSessionKey?: string;
  matchedBy?: string;
  runKey?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
  isSubagent?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readString = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
};

const readBoolean = (record: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
};

export function normalizeRouteContext(input: unknown): RouteContext | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const source = readString(input, ['source']) ?? 'unknown';

  return {
    source,
    providerId: readString(input, ['providerId', 'provider_id']),
    accountId: readString(input, ['accountId', 'account_id']),
    channel: readString(input, ['channel']),
    agentId: readString(input, ['agentId', 'agent_id']),
    senderId: readString(input, ['senderId', 'sender_id']),
    sessionKey: readString(input, ['sessionKey', 'session_key']),
    mainSessionKey: readString(input, ['mainSessionKey', 'main_session_key']),
    matchedBy: readString(input, ['matchedBy', 'matched_by']),
    runKey: readString(input, ['runKey', 'run_key']),
    senderIsOwner: readBoolean(input, ['senderIsOwner', 'sender_is_owner']),
    sandboxed: readBoolean(input, ['sandboxed', 'isSandboxed', 'is_sandboxed']),
    isSubagent: readBoolean(input, ['isSubagent', 'is_subagent']),
  };
}

export function routeContextFromWorkItemContext(context: unknown): RouteContext | undefined {
  if (!isRecord(context)) {
    return undefined;
  }

  const routeContext = context.routeContext ?? context.route_context;
  return normalizeRouteContext(routeContext);
}

export function buildCronRouteContext(params: {
  agentId: string;
  runKey: string;
  providerId?: string;
}): RouteContext {
  return {
    source: 'scheduler.cron',
    providerId: params.providerId,
    channel: 'internal',
    agentId: params.agentId,
    runKey: params.runKey,
    matchedBy: 'cron_schedule',
    senderIsOwner: true,
    sandboxed: false,
    isSubagent: false,
  };
}
