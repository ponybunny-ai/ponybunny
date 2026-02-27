import { randomUUID } from 'node:crypto';
import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';

export type DeterministicRunEventType =
  | 'PLAN_COMPILE_REQUESTED'
  | 'PLAN_COMPILE_COMPLETED'
  | 'PLAN_COMPILE_FAILED'
  | 'RUN_CREATED'
  | 'RUN_LINKED'
  | 'REPLAY_REEXECUTION_REQUESTED'
  | 'REPLAY_REEXECUTION_STEP_EXECUTED'
  | 'REPLAY_REEXECUTION_STEP_SKIPPED'
  | 'REPLAY_REEXECUTION_COMPLETED';

export interface DeterministicRunEvent {
  event_id: string;
  sequence?: number;
  run_id: string;
  plan_id?: string;
  event_type: DeterministicRunEventType;
  ts_ms: number;
  payload: Record<string, unknown>;
}

export interface DeterministicRunEventStore {
  append(event: Omit<DeterministicRunEvent, 'event_id' | 'ts_ms'>): DeterministicRunEvent;
  listByRunId(runId: string): DeterministicRunEvent[];
}

export class InMemoryDeterministicRunEventStore implements DeterministicRunEventStore {
  private readonly eventsByRun = new Map<string, DeterministicRunEvent[]>();
  private sequenceCounter = 0;

  append(event: Omit<DeterministicRunEvent, 'event_id' | 'ts_ms'>): DeterministicRunEvent {
    const materialized: DeterministicRunEvent = {
      event_id: randomUUID(),
      sequence: ++this.sequenceCounter,
      ts_ms: Date.now(),
      ...event,
    };

    const existing = this.eventsByRun.get(event.run_id) ?? [];
    existing.push(materialized);
    this.eventsByRun.set(event.run_id, existing);

    return materialized;
  }

  listByRunId(runId: string): DeterministicRunEvent[] {
    return [...(this.eventsByRun.get(runId) ?? [])];
  }
}

export class RepositoryBackedDeterministicRunEventStore implements DeterministicRunEventStore {
  private readonly fallback = new InMemoryDeterministicRunEventStore();

  constructor(private readonly repository: IWorkOrderRepository) {}

  append(event: Omit<DeterministicRunEvent, 'event_id' | 'ts_ms'>): DeterministicRunEvent {
    if (!this.repository.appendRunEvent) {
      return this.fallback.append(event);
    }

    return this.repository.appendRunEvent({
      run_id: event.run_id,
      plan_id: event.plan_id,
      event_type: event.event_type,
      payload: event.payload,
    });
  }

  listByRunId(runId: string): DeterministicRunEvent[] {
    if (!this.repository.listRunEvents) {
      return this.fallback.listByRunId(runId);
    }

    return this.repository.listRunEvents({ run_id: runId });
  }
}
