import type { CompiledAgentSchedule } from '../agents/config/index.js';
import { resolveCatchUpPolicy } from '../agents/scheduling-semantics.js';
import { getNextCronFireTimeMs } from './cron-adapter.js';

export interface ScheduleComputationInput {
  schedule: CompiledAgentSchedule;
  nowMs: number;
  last_run_at_ms?: number;
  next_run_at_ms?: number;
}

export interface ScheduleComputationResult {
  due: boolean;
  scheduled_for_ms: number | null;
  next_run_at_ms: number | null;
  coalesced_count: number;
}

const isFiniteMs = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const requireFiniteMs = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite timestamp in milliseconds.`);
  }
};

const computeIntervalFirstDueMs = (params: {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  nowMs: number;
  everyMs: number;
}): number => {
  if (isFiniteMs(params.nextRunAtMs)) {
    return params.nextRunAtMs;
  }

  if (isFiniteMs(params.lastRunAtMs)) {
    return params.lastRunAtMs + params.everyMs;
  }

  return params.nowMs;
};

const computeCronFirstDueMs = (params: {
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  nowMs: number;
  cron: string;
  tz?: string;
}): number => {
  if (isFiniteMs(params.nextRunAtMs)) {
    return params.nextRunAtMs;
  }

  if (isFiniteMs(params.lastRunAtMs)) {
    return getNextCronFireTimeMs({ cron: params.cron, fromMs: params.lastRunAtMs, tz: params.tz });
  }

  return getNextCronFireTimeMs({ cron: params.cron, fromMs: params.nowMs, tz: params.tz });
};

export function computeScheduleOutcome(
  input: ScheduleComputationInput
): ScheduleComputationResult {
  requireFiniteMs(input.nowMs, 'nowMs');
  const catchUp = resolveCatchUpPolicy(input.schedule.catchUp);
  if (catchUp.mode !== 'coalesce') {
    throw new Error(`Unsupported catch-up mode: ${catchUp.mode}`);
  }

  if (input.schedule.kind === 'interval') {
    const everyMs = input.schedule.everyMs;
    if (everyMs === undefined || !Number.isFinite(everyMs) || everyMs <= 0) {
      throw new Error('everyMs must be a positive interval');
    }

    const firstDueMs = computeIntervalFirstDueMs({
      nextRunAtMs: input.next_run_at_ms,
      lastRunAtMs: input.last_run_at_ms,
      nowMs: input.nowMs,
      everyMs,
    });

    if (input.nowMs < firstDueMs) {
      return {
        due: false,
        scheduled_for_ms: null,
        next_run_at_ms: firstDueMs,
        coalesced_count: 0,
      };
    }

    const intervalsBehind = Math.floor((input.nowMs - firstDueMs) / everyMs);
    const scheduledForMs = firstDueMs + intervalsBehind * everyMs;

    return {
      due: true,
      scheduled_for_ms: scheduledForMs,
      next_run_at_ms: scheduledForMs + everyMs,
      coalesced_count: intervalsBehind,
    };
  }

  if (!input.schedule.cron) {
    throw new Error('Missing cron expression for cron schedule');
  }

  const firstDueMs = computeCronFirstDueMs({
    nextRunAtMs: input.next_run_at_ms,
    lastRunAtMs: input.last_run_at_ms,
    nowMs: input.nowMs,
    cron: input.schedule.cron,
    tz: input.schedule.tz,
  });

  if (input.nowMs < firstDueMs) {
    return {
      due: false,
      scheduled_for_ms: null,
      next_run_at_ms: firstDueMs,
      coalesced_count: 0,
    };
  }

  let scheduledForMs = firstDueMs;
  let coalescedCount = 0;
  let nextRunAtMs = getNextCronFireTimeMs({
    cron: input.schedule.cron,
    fromMs: scheduledForMs,
    tz: input.schedule.tz,
  });

  while (nextRunAtMs <= input.nowMs) {
    scheduledForMs = nextRunAtMs;
    coalescedCount += 1;
    nextRunAtMs = getNextCronFireTimeMs({
      cron: input.schedule.cron,
      fromMs: scheduledForMs,
      tz: input.schedule.tz,
    });
  }

  return {
    due: true,
    scheduled_for_ms: scheduledForMs,
    next_run_at_ms: nextRunAtMs,
    coalesced_count: coalescedCount,
  };
}
