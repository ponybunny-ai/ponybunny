export type ScheduleDefinition = CronScheduleDefinition | IntervalScheduleDefinition;

export interface BaseScheduleDefinition {
  tz?: string;
  catchUp?: CatchUpPolicy;
}

export interface CronScheduleDefinition extends BaseScheduleDefinition {
  cron: string;
  everyMs?: never;
}

export interface IntervalScheduleDefinition extends BaseScheduleDefinition {
  everyMs: number;
  cron?: never;
}

export type CatchUpMode = 'coalesce' | 'catch_up';

export interface CatchUpPolicy {
  mode?: CatchUpMode;
  maxCatchUpWindowMs?: number;
  maxRunsPerTick?: number;
}

export interface ResolvedCatchUpPolicy {
  mode: CatchUpMode;
  maxCatchUpWindowMs?: number;
  maxRunsPerTick?: number;
}

export const DEFAULT_CATCH_UP_MODE: CatchUpMode = 'coalesce';
export const DEFAULT_CATCH_UP_POLICY: ResolvedCatchUpPolicy = {
  mode: DEFAULT_CATCH_UP_MODE,
};

export const DEFAULT_AGENT_CONCURRENCY = 1;

export interface CoalesceIntervalInput {
  lastScheduledForMs: number;
  nowMs: number;
  everyMs: number;
}

export interface CoalesceIntervalResult {
  scheduledForMs: number;
  nextScheduledForMs: number;
}

export function resolveCatchUpPolicy(policy?: CatchUpPolicy): ResolvedCatchUpPolicy {
  return {
    ...DEFAULT_CATCH_UP_POLICY,
    ...(policy ?? {}),
  };
}

export function computeCoalesceNextIntervalRun(
  input: CoalesceIntervalInput,
): CoalesceIntervalResult {
  const { lastScheduledForMs, nowMs, everyMs } = input;

  if (everyMs <= 0) {
    throw new Error('everyMs must be a positive interval');
  }

  if (nowMs <= lastScheduledForMs) {
    return {
      scheduledForMs: lastScheduledForMs,
      nextScheduledForMs: lastScheduledForMs + everyMs,
    };
  }

  const elapsedMs = nowMs - lastScheduledForMs;
  const intervalsElapsed = Math.floor(elapsedMs / everyMs);
  const scheduledForMs = lastScheduledForMs + intervalsElapsed * everyMs;

  return {
    scheduledForMs,
    nextScheduledForMs: scheduledForMs + everyMs,
  };
}

export const IDEMPOTENCY_KEY_DELIMITER = ':';

export function buildRecurringIdempotencyKey(
  agentId: string,
  scheduledForMs: number,
): string {
  return `${agentId}${IDEMPOTENCY_KEY_DELIMITER}${scheduledForMs}`;
}
