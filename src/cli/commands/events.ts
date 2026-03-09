import { Command } from 'commander';
import chalk from 'chalk';
import Database from 'better-sqlite3';

import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { runtimeEventBus, RuntimeEventStore, type RuntimeEvent, type RuntimeEventCursor } from '../../runtime/event-bus/index.js';

const DEFAULT_DB_PATH = loadRuntimeConfig().paths.database;
const DEFAULT_TAIL_LIMIT = 20;
const DEFAULT_POLL_MS = 1000;
const POLL_BATCH_SIZE = 100;
const MAX_SEEN_EVENT_IDS = 4096;
const MAX_SUMMARY_PARTS = 4;
const MAX_SUMMARY_LENGTH = 80;

function normalizePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function formatEventField(value?: string): string {
  return typeof value === 'string' && value.length > 0 ? value : '-';
}

export function formatRuntimeEventLine(event: RuntimeEvent): string {
  return [
    new Date(event.timestamp).toISOString(),
    event.type,
    formatEventField(event.goalId),
    formatEventField(event.taskId),
    formatEventField(event.source),
  ].join(' | ');
}

function clipSummary(value: string): string {
  return value.length > MAX_SUMMARY_LENGTH
    ? `${value.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
    : value;
}

function formatPayloadScalar(value: unknown): string | null {
  if (typeof value === 'string') {
    return clipSummary(value.replace(/\s+/g, ' ').trim());
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return null;
}

export function summarizeRuntimeEventPayload(payload: unknown): string {
  if (payload === undefined) {
    return '-';
  }

  const scalar = formatPayloadScalar(payload);
  if (scalar !== null) {
    return scalar.length > 0 ? scalar : '""';
  }

  if (Array.isArray(payload)) {
    return `items=${payload.length}`;
  }

  if (!payload || typeof payload !== 'object') {
    return clipSummary(String(payload));
  }

  const ignoredKeys = new Set([
    'id',
    'type',
    'timestamp',
    'goalId',
    'taskId',
    'workItemId',
    'runId',
    'source',
  ]);
  const parts: string[] = [];

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (ignoredKeys.has(key)) {
      continue;
    }

    const entryScalar = formatPayloadScalar(value);
    if (entryScalar !== null) {
      parts.push(`${key}=${entryScalar.length > 0 ? entryScalar : '""'}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`);
    } else if (value && typeof value === 'object') {
      const nestedKeys = Object.keys(value as Record<string, unknown>);
      const nestedSummary = nestedKeys.length > 0
        ? nestedKeys.slice(0, 2).join(',')
        : 'object';
      parts.push(`${key}={${nestedSummary}${nestedKeys.length > 2 ? ',...' : ''}}`);
    }

    if (parts.length >= MAX_SUMMARY_PARTS) {
      break;
    }
  }

  if (parts.length > 0) {
    return clipSummary(parts.join(', '));
  }

  const keys = Object.keys(payload as Record<string, unknown>);
  if (keys.length === 0) {
    return '{}';
  }

  return clipSummary(`keys=${keys.slice(0, MAX_SUMMARY_PARTS).join(',')}${keys.length > MAX_SUMMARY_PARTS ? ',...' : ''}`);
}

export function formatRuntimeReplayLine(event: RuntimeEvent): string {
  return [
    new Date(event.timestamp).toISOString(),
    event.type,
    formatEventField(event.taskId),
    formatEventField(event.runId),
    formatEventField(event.source),
    summarizeRuntimeEventPayload(event.payload),
  ].join(' | ');
}

function createSeenEventTracker() {
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    add(id: string): boolean {
      if (seen.has(id)) {
        return false;
      }

      seen.add(id);
      order.push(id);

      while (order.length > MAX_SEEN_EVENT_IDS) {
        const staleId = order.shift();
        if (staleId) {
          seen.delete(staleId);
        }
      }

      return true;
    },
  };
}

function hasRuntimeEventsTable(db: Database.Database): boolean {
  const row = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'runtime_events'
    `)
    .get() as { name?: string } | undefined;

  return row?.name === 'runtime_events';
}

async function tailRuntimeEvents(options: {
  db: string;
  limit?: string;
  pollMs?: string;
}): Promise<void> {
  const limit = normalizePositiveInt(options.limit, DEFAULT_TAIL_LIMIT);
  const pollMs = normalizePositiveInt(options.pollMs, DEFAULT_POLL_MS);

  let db: Database.Database;
  try {
    db = new Database(options.db, { readonly: true, fileMustExist: true });
  } catch (error) {
    console.error(chalk.red(`Unable to open runtime event database at ${options.db}: ${(error as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const store = new RuntimeEventStore(db);
  if (!hasRuntimeEventsTable(db)) {
    db.close();
    console.error(chalk.red(`Runtime event storage is not initialized in ${options.db}.`));
    process.exitCode = 1;
    return;
  }

  const seenEvents = createSeenEventTracker();
  let cursor: RuntimeEventCursor | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let stopTail: (() => void) | null = null;
  let pollError: Error | null = null;

  const printEvent = (event: RuntimeEvent): void => {
    if (!seenEvents.add(event.id)) {
      return;
    }

    console.log(formatRuntimeEventLine(event));
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    stopTail?.();
  };

  const schedulePoll = (): void => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      void pollPersistedEvents();
    }, pollMs);
  };

  const pollPersistedEvents = async (): Promise<void> => {
    try {
      while (!stopped) {
        const page = store.listAfter(cursor, POLL_BATCH_SIZE);
        if (page.events.length === 0) {
          break;
        }

        for (const event of page.events) {
          printEvent(event);
        }

        cursor = page.cursor;

        if (page.events.length < POLL_BATCH_SIZE) {
          break;
        }
      }
    } catch (error) {
      pollError = error as Error;
      stop();
      return;
    }

    schedulePoll();
  };

  console.log('timestamp | type | goalId | taskId | source');

  try {
    const initialPage = store.listRecentPage(limit);
    for (const event of initialPage.events) {
      printEvent(event);
    }
    cursor = initialPage.cursor;
  } catch (error) {
    db.close();
    console.error(chalk.red(`Unable to read runtime events from ${options.db}: ${(error as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const unsubscribe = runtimeEventBus.subscribeAll((event) => {
    printEvent(event);
  });

  const stopPromise = new Promise<void>((resolve) => {
    stopTail = resolve;
  });

  const signalHandler = (): void => {
    stop();
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  schedulePoll();
  await stopPromise;

  unsubscribe();
  process.off('SIGINT', signalHandler);
  process.off('SIGTERM', signalHandler);
  db.close();

  const finalPollError: Error | null = pollError;
  if (finalPollError) {
    console.error(chalk.red(`Failed to tail runtime events: ${String(finalPollError)}`));
    process.exitCode = 1;
  }
}

async function replayRuntimeEvents(
  goalId: string,
  options: {
    db: string;
  }
): Promise<void> {
  let db: Database.Database;
  try {
    db = new Database(options.db, { readonly: true, fileMustExist: true });
  } catch (error) {
    console.error(chalk.red(`Unable to open runtime event database at ${options.db}: ${(error as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const store = new RuntimeEventStore(db);
  if (!hasRuntimeEventsTable(db)) {
    db.close();
    console.error(chalk.red(`Runtime event storage is not initialized in ${options.db}.`));
    process.exitCode = 1;
    return;
  }

  try {
    const events = store.listByGoal(goalId);
    if (events.length === 0) {
      console.log(`No runtime events found for goal ${goalId}.`);
      return;
    }

    console.log(`Replay for goal ${goalId} (inspection only)`);
    console.log('timestamp | type | taskId | runId | source | summary');
    for (const event of events) {
      console.log(formatRuntimeReplayLine(event));
    }
  } catch (error) {
    console.error(chalk.red(`Unable to replay runtime events for goal ${goalId}: ${(error as Error).message}`));
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

export function createEventsCommand(): Command {
  const events = new Command('events')
    .description('Inspect runtime events');

  events
    .command('tail')
    .description('Tail runtime events in a line-based format')
    .option('--db <path>', 'Path to SQLite database', DEFAULT_DB_PATH)
    .option('-n, --limit <number>', 'Number of recent events to print before tailing', String(DEFAULT_TAIL_LIMIT))
    .option('--poll-ms <number>', 'Polling interval for persisted runtime events', String(DEFAULT_POLL_MS))
    .action(tailRuntimeEvents);

  events
    .command('replay <goalId>')
    .description('Print the recorded runtime event timeline for a goal')
    .option('--db <path>', 'Path to SQLite database', DEFAULT_DB_PATH)
    .action(replayRuntimeEvents);

  return events;
}
