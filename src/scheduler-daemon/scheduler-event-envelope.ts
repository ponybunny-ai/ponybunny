import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { SchedulerEvent } from '../scheduler/types.js';

type SchedulerEventChannelType = 'tui' | 'webui' | 'email' | 'telegram' | 'whatsapp' | 'discord';

interface SchedulerEventEnvelope {
  sessionId?: string;
  channelType?: SchedulerEventChannelType;
  channelSessionId?: string;
}

export class SchedulerEventEnvelopeResolver {
  private goalContextCache = new Map<string, SchedulerEventEnvelope>();

  constructor(private repository: IWorkOrderRepository) {}

  resolve(event: SchedulerEvent): SchedulerEvent {
    const envelope = this.resolveFromDomainIds(event.goalId, event.workItemId, event.runId);
    if (!envelope.sessionId && !envelope.channelType && !envelope.channelSessionId) {
      return event;
    }

    return {
      ...event,
      data: {
        sessionId: envelope.sessionId,
        channelType: envelope.channelType,
        channelSessionId: envelope.channelSessionId,
        ...(event.data ?? {}),
      },
    };
  }

  private resolveFromDomainIds(
    goalId?: string,
    workItemId?: string,
    runId?: string
  ): SchedulerEventEnvelope {
    const resolvedGoalId = this.resolveGoalId(goalId, workItemId, runId);
    if (!resolvedGoalId) {
      return {};
    }

    const cached = this.goalContextCache.get(resolvedGoalId);
    if (cached) {
      return cached;
    }

    const goal = this.repository.getGoal(resolvedGoalId);
    if (!goal || !goal.context || typeof goal.context !== 'object') {
      return {};
    }

    const context = goal.context as Record<string, unknown>;
    const resolved: SchedulerEventEnvelope = {
      sessionId: this.readStringField(context, ['sessionId', 'session_id']),
      channelSessionId: this.readStringField(context, ['channelSessionId', 'channel_session_id']),
      channelType: this.parseChannelType(this.readStringField(context, ['channelType', 'channel_type'])),
    };

    this.goalContextCache.set(resolvedGoalId, resolved);
    if (this.goalContextCache.size > 5000) {
      const oldestKey = this.goalContextCache.keys().next().value;
      if (typeof oldestKey === 'string') {
        this.goalContextCache.delete(oldestKey);
      }
    }

    return resolved;
  }

  private resolveGoalId(goalId?: string, workItemId?: string, runId?: string): string | undefined {
    if (goalId) {
      return goalId;
    }

    if (workItemId) {
      const workItem = this.repository.getWorkItem(workItemId);
      if (workItem && typeof workItem.goal_id === 'string' && workItem.goal_id.length > 0) {
        return workItem.goal_id;
      }
    }

    if (runId) {
      const run = this.repository.getRun(runId);
      if (run && typeof run.goal_id === 'string' && run.goal_id.length > 0) {
        return run.goal_id;
      }
    }

    return undefined;
  }

  private readStringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }

    return undefined;
  }

  private parseChannelType(value: string | undefined): SchedulerEventChannelType | undefined {
    if (
      value === 'tui'
      || value === 'webui'
      || value === 'email'
      || value === 'telegram'
      || value === 'whatsapp'
      || value === 'discord'
    ) {
      return value;
    }

    return undefined;
  }
}
