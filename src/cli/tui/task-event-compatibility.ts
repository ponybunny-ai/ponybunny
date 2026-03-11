import type { GatewayCompatibilityEventType } from '../../gateway/compatibility.js';

export interface TaskCompatibilityActionHint {
  label: string;
  kind: 'file' | 'url' | 'command';
  target: string;
}

export interface TaskCompatibilityMessageUpdates {
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  statusText?: string;
  resultSummary?: string;
  actions?: TaskCompatibilityActionHint[];
}

export interface TaskCompatibilityHandlers {
  updateSimpleMessageByGoalId(goalId: string, updates: TaskCompatibilityMessageUpdates): void;
  appendTimelineByGoalId(goalId: string, stage: string, detail?: string): void;
  updateLatestProcessingMessage(updates: TaskCompatibilityMessageUpdates): void;
  appendTimelineLatest(stage: string, detail?: string): void;
  extractActionHints(summary: string): TaskCompatibilityActionHint[];
}

/**
 * Legacy gateway-facing `task.*` event handling retained only for older
 * compatibility senders. The authoritative live TUI protocol is handled in the
 * main `goal.*` / `workitem.*` / `run.*` / `verification.*` switch.
 */
export function handleTaskCompatibilityEvent(
  eventType: GatewayCompatibilityEventType,
  data: Record<string, unknown> | undefined,
  handlers: TaskCompatibilityHandlers
): void {
  switch (eventType) {
    case 'task.narration': {
      const stage = typeof data?.stage === 'string' ? data.stage : 'Execution update';
      const detail = typeof data?.message === 'string' ? data.message : undefined;

      if (typeof data?.goalId === 'string') {
        handlers.appendTimelineByGoalId(data.goalId, stage, detail);
        if (typeof data?.statusText === 'string') {
          handlers.updateSimpleMessageByGoalId(data.goalId, {
            statusText: data.statusText,
            status: 'processing',
          });
        }
        return;
      }

      handlers.appendTimelineLatest(stage, detail);
      if (typeof data?.statusText === 'string') {
        handlers.updateLatestProcessingMessage({
          statusText: data.statusText,
          status: 'processing',
        });
      }
      return;
    }

    case 'task.result': {
      const summary = typeof data?.summary === 'string' ? data.summary : undefined;
      const actions = summary ? handlers.extractActionHints(summary) : undefined;
      const status = typeof data?.success === 'boolean'
        ? (data.success ? 'completed' : 'failed')
        : undefined;

      if (typeof data?.goalId === 'string') {
        handlers.updateSimpleMessageByGoalId(data.goalId, {
          resultSummary: summary,
          actions,
          status,
        });
        handlers.appendTimelineByGoalId(data.goalId, 'Final result generated', summary);
        return;
      }

      handlers.updateLatestProcessingMessage({
        resultSummary: summary,
        actions,
        status,
      });
      handlers.appendTimelineLatest('Final result generated', summary);
      return;
    }
  }
}
