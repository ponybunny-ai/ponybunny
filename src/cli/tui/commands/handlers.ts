/**
 * Command Handlers - Execute slash commands
 */

import type { AppContextValue } from '../context/app-context.js';
import type { GatewayContextValue } from '../context/gateway-context.js';
import { parseCommand, findCommand, type ParsedCommand } from './registry.js';
import type { RuntimeSnapshot } from '../store/types.js';
import type { InternalRuntimeRunEventsPruneParams } from '../../gateway/tui-gateway-client.js';

export interface CommandContext {
  app: AppContextValue;
  gateway: GatewayContextValue;
  exit: () => void;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  error?: string;
}

type CommandHandler = (
  cmd: ParsedCommand,
  ctx: CommandContext
) => Promise<CommandResult> | CommandResult;

function parseBooleanValue(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseRolloutSetArgs(args: string[]): {
  shadowModeEnabled?: boolean;
  canaryPercent?: number;
  rollbackOnFailure?: boolean;
} {
  const payload: {
    shadowModeEnabled?: boolean;
    canaryPercent?: number;
    rollbackOnFailure?: boolean;
  } = {};

  for (const token of args) {
    const [rawKey, rawValue] = token.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();

    if (!key || !value) {
      throw new Error(`Invalid rollout argument: ${token}. Use key=value format.`);
    }

    if (key === 'shadow') {
      const parsed = parseBooleanValue(value);
      if (parsed === undefined) {
        throw new Error('shadow must be true or false');
      }
      payload.shadowModeEnabled = parsed;
      continue;
    }

    if (key === 'canary') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        throw new Error('canary must be an integer between 0 and 100');
      }
      payload.canaryPercent = parsed;
      continue;
    }

    if (key === 'rollback') {
      const parsed = parseBooleanValue(value);
      if (parsed === undefined) {
        throw new Error('rollback must be true or false');
      }
      payload.rollbackOnFailure = parsed;
      continue;
    }

    throw new Error(`Unsupported rollout key: ${key}`);
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('No valid rollout parameters provided');
  }

  return payload;
}

function parseReplayOptions(tokens: string[]): {
  mode?: 'facts_only' | 'reexecute_tools';
  allowTools?: string[];
  maxAttempts?: number;
  enableExecution?: boolean;
  reexecutionIdempotencyKey?: string;
  eventsLimit?: number;
  cursor?: string;
} {
  const options: {
    mode?: 'facts_only' | 'reexecute_tools';
    allowTools?: string[];
    maxAttempts?: number;
    enableExecution?: boolean;
    reexecutionIdempotencyKey?: string;
    eventsLimit?: number;
    cursor?: string;
  } = {};

  for (const token of tokens) {
    const [rawKey, rawValue] = token.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();

    if (!key || !value) {
      throw new Error(`Invalid replay option: ${token}. Use key=value format.`);
    }

    if (key === 'mode') {
      if (value !== 'facts_only' && value !== 'reexecute_tools') {
        throw new Error('mode must be facts_only or reexecute_tools');
      }
      options.mode = value;
      continue;
    }

    if (key === 'allowtools') {
      const tools = value.split(',').map((part) => part.trim()).filter(Boolean);
      if (tools.length === 0) {
        throw new Error('allowTools must include at least one tool name');
      }
      options.allowTools = tools;
      continue;
    }

    if (key === 'maxattempts') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
        throw new Error('maxAttempts must be an integer between 1 and 200');
      }
      options.maxAttempts = parsed;
      continue;
    }

    if (key === 'enableexecution') {
      const parsed = parseBooleanValue(value);
      if (parsed === undefined) {
        throw new Error('enableExecution must be true or false');
      }
      options.enableExecution = parsed;
      continue;
    }

    if (key === 'reexecutionidempotencykey') {
      if (value.length === 0) {
        throw new Error('reexecutionIdempotencyKey must be a non-empty string');
      }

      options.reexecutionIdempotencyKey = value;
      continue;
    }

    if (key === 'eventslimit') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
        throw new Error('eventsLimit must be an integer between 1 and 500');
      }
      options.eventsLimit = parsed;
      continue;
    }

    if (key === 'cursor') {
      if (value.length === 0) {
        throw new Error('cursor must be a non-empty string');
      }
      options.cursor = value;
      continue;
    }

    throw new Error(`Unsupported replay option: ${key}`);
  }

  return options;
}

function parsePruneEventsOptions(tokens: string[]): {
  beforeTsMs: number;
  runId?: string;
  runIds?: string[];
  eventTypes?: InternalRuntimeRunEventsPruneParams['eventTypes'];
  keepLatestPerRun?: number;
} {
  const allowedEventTypes: Array<NonNullable<InternalRuntimeRunEventsPruneParams['eventTypes']>[number]> = [
    'PLAN_COMPILE_REQUESTED',
    'PLAN_COMPILE_COMPLETED',
    'PLAN_COMPILE_FAILED',
    'RUN_CREATED',
    'RUN_LINKED',
    'REPLAY_REEXECUTION_REQUESTED',
    'REPLAY_REEXECUTION_STEP_EXECUTED',
    'REPLAY_REEXECUTION_STEP_SKIPPED',
    'REPLAY_REEXECUTION_COMPLETED',
  ];

  const options: {
    beforeTsMs?: number;
    runId?: string;
    runIds?: string[];
    eventTypes?: InternalRuntimeRunEventsPruneParams['eventTypes'];
    keepLatestPerRun?: number;
  } = {};

  for (const token of tokens) {
    const [rawKey, rawValue] = token.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();

    if (!key || !value) {
      throw new Error(`Invalid prune option: ${token}. Use key=value format.`);
    }

    if (key === 'beforetsms') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('beforeTsMs must be a non-negative integer');
      }
      options.beforeTsMs = parsed;
      continue;
    }

    if (key === 'runid') {
      options.runId = value;
      continue;
    }

    if (key === 'runids') {
      const runIds = value.split(',').map((part) => part.trim()).filter(Boolean);
      if (runIds.length === 0) {
        throw new Error('runIds must include at least one run ID');
      }
      options.runIds = runIds;
      continue;
    }

    if (key === 'eventtypes') {
      const eventTypes = value
        .split(',')
        .map((part) => part.trim())
        .filter((part): part is NonNullable<InternalRuntimeRunEventsPruneParams['eventTypes']>[number] =>
          allowedEventTypes.includes(part as NonNullable<InternalRuntimeRunEventsPruneParams['eventTypes']>[number])
        );
      if (eventTypes.length === 0) {
        throw new Error('eventTypes must include at least one event type');
      }

      const rawTypes = value.split(',').map((part) => part.trim()).filter(Boolean);
      if (rawTypes.length !== eventTypes.length) {
        throw new Error('eventTypes contains unsupported event type values');
      }

      options.eventTypes = eventTypes;
      continue;
    }

    if (key === 'keeplatestperrun') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('keepLatestPerRun must be a non-negative integer');
      }
      options.keepLatestPerRun = parsed;
      continue;
    }

    throw new Error(`Unsupported prune option: ${key}`);
  }

  if (options.beforeTsMs === undefined) {
    throw new Error('beforeTsMs is required');
  }

  return {
    beforeTsMs: options.beforeTsMs,
    runId: options.runId,
    runIds: options.runIds,
    eventTypes: options.eventTypes,
    keepLatestPerRun: options.keepLatestPerRun,
  };
}

async function refreshSchedulerData(ctx: CommandContext): Promise<CommandResult> {
  const client = ctx.gateway.client;
  if (!client) {
    return { success: false, error: 'Not connected to gateway' };
  }

  ctx.app.setActivityStatus('refreshing scheduler data...');
  try {
    const [goalsResult, workItemsResult, escalationsResult, capabilities] = await Promise.all([
      client.listGoals(),
      client.listWorkItems(),
      client.listEscalations(),
      client.getSystemCapabilities(),
    ]);

    ctx.app.setGoals(goalsResult.goals);
    ctx.app.setWorkItems(workItemsResult.workItems);
    ctx.app.setEscalations(escalationsResult.escalations as Parameters<typeof ctx.app.setEscalations>[0]);
    ctx.app.setSchedulerCapabilities(capabilities);
    ctx.app.addEvent('scheduler.refreshed', {
      goals: goalsResult.goals.length,
      workItems: workItemsResult.workItems.length,
      escalations: escalationsResult.escalations.length,
      schedulerConnected: capabilities.schedulerConnected,
    });

    return {
      success: true,
      message: `Refreshed scheduler data (goals: ${goalsResult.goals.length}, work items: ${workItemsResult.workItems.length}, escalations: ${escalationsResult.escalations.length})`,
    };
  } catch (err) {
    return { success: false, error: `Refresh failed: ${(err as Error).message}` };
  } finally {
    ctx.app.setActivityStatus('idle');
  }
}

async function refreshRuntimeData(ctx: CommandContext, goalId?: string): Promise<CommandResult> {
  const client = ctx.gateway.client;
  if (!client) {
    return { success: false, error: 'Not connected to gateway' };
  }

  ctx.app.setActivityStatus('refreshing runtime data...');
  try {
    const [runtimeConfig, rolloutStatus, goalsResult] = await Promise.all([
      client.getInternalRuntimeConfig(),
      client.getRuntimeRolloutStatus(),
      client.listGoals({ limit: 20 }),
    ]);

    const targetGoalId = goalId ?? goalsResult.goals[0]?.id;
    if (!targetGoalId) {
      ctx.app.addEvent('runtime.refreshed', {
        schedulerMode: runtimeConfig.toolRoutingMode,
        deterministicRuntimeEnabled: runtimeConfig.deterministicRuntimeEnabled,
        planCompilerEnabled: runtimeConfig.planCompilerEnabled,
        rolloutMode: rolloutStatus.mode,
        shadowModeEnabled: rolloutStatus.rollout.shadowModeEnabled,
        canaryPercent: rolloutStatus.rollout.canaryPercent,
        dryRunStats: {
          total: rolloutStatus.metrics.dryRunsTotal,
          succeeded: rolloutStatus.metrics.dryRunsSucceeded,
          failed: rolloutStatus.metrics.dryRunsFailed,
        },
        dryRun: false,
      });

      return {
        success: true,
        message: 'Runtime config refreshed (no goals available for dry run)',
      };
    }

    const dryRun = await client.executeInternalRuntimeDryRun({ goalId: targetGoalId });
    const replaySummary = dryRun.replay?.summary as {
      compile_run_id?: string;
      runtime_run_id?: string;
      total_events?: number;
      facts_count?: number;
      artifacts_count?: number;
    } | undefined;
    const compileRunId = replaySummary?.compile_run_id;
    const runtimeRunId = replaySummary?.runtime_run_id;

    let timelineStatus: string | undefined;
    if (runtimeRunId) {
      try {
        const timeline = await client.getInternalRunTimeline(runtimeRunId, compileRunId);
        timelineStatus = timeline.status;
      } catch {
        timelineStatus = undefined;
      }
    }

    let returnedEvents = 0;
    if (runtimeRunId) {
      try {
        const events = await client.getInternalRunEvents({
          runId: runtimeRunId,
          relatedRunId: compileRunId,
          limit: 50,
          offset: 0,
        });
        returnedEvents = events.returned;
      } catch {
        returnedEvents = 0;
      }
    }

    let reexecutionSummary:
      | {
        attemptedSteps: number;
        eligibleSteps: number;
        executedSteps: number;
        skippedSteps: number;
      }
      | undefined;

    if (runtimeRunId || compileRunId) {
      try {
        const replayRunId = runtimeRunId ?? compileRunId;
        const replayRelatedRunId = runtimeRunId ? compileRunId : undefined;
        if (replayRunId) {
          const reexecutionReplay = await client.replayInternalRun(
            replayRunId,
            replayRelatedRunId,
            'reexecute_tools',
            { maxAttempts: 20 }
          );

          if (reexecutionReplay.reexecution) {
            reexecutionSummary = {
              attemptedSteps: reexecutionReplay.reexecution.attempted_steps,
              eligibleSteps: reexecutionReplay.reexecution.eligible_steps,
              executedSteps: reexecutionReplay.reexecution.executed_steps,
              skippedSteps: reexecutionReplay.reexecution.skipped.length,
            };
          }
        }
      } catch {
        reexecutionSummary = undefined;
      }
    }

    const snapshot: RuntimeSnapshot = {
      id: `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      goalId: targetGoalId,
      runId: runtimeRunId ?? compileRunId,
      source: 'runtime_refresh',
      config: {
        deterministicRuntimeEnabled: runtimeConfig.deterministicRuntimeEnabled,
        planCompilerEnabled: runtimeConfig.planCompilerEnabled,
        toolRoutingMode: runtimeConfig.toolRoutingMode,
        runtimeRollout: runtimeConfig.runtimeRollout,
      },
      dryRun: {
        ok: dryRun.ok,
        status: dryRun.report?.status as string | undefined,
        compileRunId,
        runtimeRunId,
        totalEvents: replaySummary?.total_events,
        factsCount: replaySummary?.facts_count,
        artifactsCount: replaySummary?.artifacts_count,
        reexecution: reexecutionSummary,
      },
    };
    ctx.app.addRuntimeSnapshot(snapshot);

    ctx.app.addEvent('runtime.refreshed', {
      schedulerMode: runtimeConfig.toolRoutingMode,
      deterministicRuntimeEnabled: runtimeConfig.deterministicRuntimeEnabled,
      planCompilerEnabled: runtimeConfig.planCompilerEnabled,
      rolloutMode: rolloutStatus.mode,
      shadowModeEnabled: rolloutStatus.rollout.shadowModeEnabled,
      canaryPercent: rolloutStatus.rollout.canaryPercent,
      dryRunStats: {
        total: rolloutStatus.metrics.dryRunsTotal,
        succeeded: rolloutStatus.metrics.dryRunsSucceeded,
        failed: rolloutStatus.metrics.dryRunsFailed,
      },
      dryRunGoalId: targetGoalId,
      dryRunOk: dryRun.ok,
      dryRunStatus: dryRun.report?.status,
      timelineStatus,
      returnedEvents,
      replayReexecution: reexecutionSummary,
      compileRunId,
      runtimeRunId,
    });

    return {
      success: true,
      message: `Runtime refreshed (goal: ${targetGoalId}, dryRun: ${dryRun.ok ? 'ok' : 'failed'})`,
    };
  } catch (err) {
    return { success: false, error: `Runtime refresh failed: ${(err as Error).message}` };
  } finally {
    ctx.app.setActivityStatus('idle');
  }
}

const handlers: Record<string, CommandHandler> = {
  // Help command
  help: (_cmd, ctx) => {
    ctx.app.setView('help');
    return { success: true };
  },

  // Goal commands
  new: (_cmd, ctx) => {
    ctx.app.openModal('goal-create');
    return { success: true };
  },

  goals: (_cmd, ctx) => {
    ctx.app.setView('goals');
    return { success: true };
  },

  goal: async (cmd, ctx) => {
    const [goalId] = cmd.args;
    if (!goalId) {
      return { success: false, error: 'Goal ID is required. Usage: /goal <id>' };
    }
    ctx.app.selectGoal(goalId);
    ctx.app.setView('goals');
    return { success: true };
  },

  cancel: async (cmd, ctx) => {
    const [goalId] = cmd.args;
    if (!goalId) {
      return { success: false, error: 'Goal ID is required. Usage: /cancel <id>' };
    }

    ctx.app.openModal('confirm', {
      title: 'Cancel Goal',
      message: `Are you sure you want to cancel goal ${goalId}?`,
      onConfirm: async () => {
        try {
          const client = ctx.gateway.client;
          if (client) {
            await client.cancelGoal(goalId);
            ctx.app.addEvent('goal.cancelled', { goalId });
          }
        } catch (err) {
          ctx.app.addEvent('error', { message: (err as Error).message });
        }
      },
      confirmLabel: 'cancel',
      cancelLabel: 'keep',
    });
    return { success: true };
  },

  // Work item commands
  workitems: async (cmd, ctx) => {
    const [goalId] = cmd.args;
    try {
      const client = ctx.gateway.client;
      if (client) {
        const result = await client.listWorkItems(goalId ? { goalId } : undefined);
        ctx.app.setWorkItems(result.workItems);
        ctx.app.addEvent('workitems.loaded', { count: result.workItems.length });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true };
  },

  // Escalation commands
  escalations: (_cmd, ctx) => {
    const escalations = ctx.app.state.escalations;
    if (escalations.length > 0) {
      ctx.app.openModal('escalation', { escalationId: escalations[0].id });
    } else {
      return { success: true, message: 'No pending escalations' };
    }
    return { success: true };
  },

  approvals: (_cmd, ctx) => {
    // For now, show escalations view
    ctx.app.setView('dashboard');
    return { success: true, message: 'Showing pending approvals on dashboard' };
  },

  approve: async (cmd, ctx) => {
    const [id] = cmd.args;
    if (!id) {
      return { success: false, error: 'Approval ID is required. Usage: /approve <id>' };
    }

    try {
      const client = ctx.gateway.client;
      if (client) {
        await client.resolveEscalation(id, { action: 'skip' });
        ctx.app.removeEscalation(id);
        ctx.app.addEvent('escalation.approved', { id });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true, message: `Approved ${id}` };
  },

  reject: async (cmd, ctx) => {
    const [id, ...reasonParts] = cmd.args;
    if (!id) {
      return { success: false, error: 'Approval ID is required. Usage: /reject <id> [reason]' };
    }

    const reason = reasonParts.join(' ') || 'Rejected by user';

    try {
      const client = ctx.gateway.client;
      if (client) {
        await client.resolveEscalation(id, {
          action: 'skip',
          data: { reason },
        });
        ctx.app.removeEscalation(id);
        ctx.app.addEvent('escalation.rejected', { id, reason });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true, message: `Rejected ${id}` };
  },

  // System commands
  status: async (_cmd, ctx) => {
    const status = ctx.gateway.connectionStatus;
    const goalCount = ctx.app.state.goals.length;
    const escalationCount = ctx.app.state.escalations.length;

    ctx.app.addEvent('system.status', {
      connection: status,
      goals: goalCount,
      escalations: escalationCount,
      url: ctx.gateway.url,
    });
    return {
      success: true,
      message: `Connection: ${status}, Goals: ${goalCount}, Escalations: ${escalationCount}`
    };
  },

  ping: async (_cmd, ctx) => {
    try {
      const client = ctx.gateway.client;
      if (client) {
        const start = Date.now();
        await client.ping();
        const latency = Date.now() - start;
        ctx.app.addEvent('system.ping', { latency });
        return { success: true, message: `Pong! (${latency}ms)` };
      }
      return { success: false, error: 'Not connected to gateway' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  reconnect: (_cmd, ctx) => {
    ctx.gateway.disconnect();
    ctx.gateway.connect();
    ctx.app.addEvent('system.reconnect', {});
    return { success: true, message: 'Reconnecting...' };
  },

  refresh: async (_cmd, ctx) => {
    const [mode, goalId] = _cmd.args;
    if (mode === 'runtime') {
      return refreshRuntimeData(ctx, goalId);
    }

    return refreshSchedulerData(ctx);
  },

  rollout: async (cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    const [action, ...rest] = cmd.args;
    if (!action) {
      return {
        success: false,
        error: 'Rollout action is required. Usage: /rollout <status|set|rollback>',
      };
    }

    const normalizedAction = action.toLowerCase();

    try {
      if (normalizedAction === 'status') {
        const status = await client.getRuntimeRolloutStatus();
        ctx.app.addEvent('runtime.rollout.status', status);
        return {
          success: true,
          message: `Rollout mode=${status.mode}, shadow=${String(status.rollout.shadowModeEnabled)}, canary=${status.rollout.canaryPercent}% dryRuns=${status.metrics.dryRunsTotal}`,
        };
      }

      if (normalizedAction === 'rollback') {
        const status = await client.updateRuntimeRollout({ rollbackToLegacy: true });
        ctx.app.addEvent('runtime.rollout.updated', {
          action: 'rollback',
          status,
        });
        return {
          success: true,
          message: 'Rollout rolled back to legacy mode',
        };
      }

      if (normalizedAction === 'set') {
        const payload = parseRolloutSetArgs(rest);
        const status = await client.updateRuntimeRollout(payload);
        ctx.app.addEvent('runtime.rollout.updated', {
          action: 'set',
          payload,
          status,
        });
        return {
          success: true,
          message: `Rollout updated: mode=${status.mode}, shadow=${String(status.rollout.shadowModeEnabled)}, canary=${status.rollout.canaryPercent}%`,
        };
      }

      return {
        success: false,
        error: 'Unsupported rollout action. Use status, set, or rollback.',
      };
    } catch (err) {
      return { success: false, error: `Rollout command failed: ${(err as Error).message}` };
    }
  },

  replay: async (cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    const [runId, secondArg, ...restArgs] = cmd.args;
    if (!runId) {
      return { success: false, error: 'Run ID is required. Usage: /replay <runId> [relatedRunId] [key=value...]' };
    }

    const hasRelatedRun = Boolean(secondArg) && !secondArg!.includes('=');
    const relatedRunId = hasRelatedRun ? secondArg : undefined;
    const optionTokens = hasRelatedRun ? restArgs : cmd.args.slice(1);

    try {
      const options = parseReplayOptions(optionTokens);
      const mode = options.mode ?? 'reexecute_tools';
      const [runtimeConfig, replay, replayEventsPage] = await Promise.all([
        client.getInternalRuntimeConfig(),
        client.replayInternalRun(runId, relatedRunId, mode, {
          allowTools: options.allowTools,
          maxAttempts: options.maxAttempts,
          enableExecution: options.enableExecution,
          ...(options.reexecutionIdempotencyKey
            ? { reexecutionIdempotencyKey: options.reexecutionIdempotencyKey }
            : {}),
        }),
        client.getInternalRunEvents({
          runId,
          ...(relatedRunId ? { relatedRunId } : {}),
          limit: options.eventsLimit ?? 50,
          ...(options.cursor !== undefined ? { cursor: options.cursor } : { offset: 0 }),
        }),
      ]);

      const replaySummary = replay.summary as {
        compile_run_id?: string;
        runtime_run_id?: string;
        total_events?: number;
        facts_count?: number;
        artifacts_count?: number;
      };

      ctx.app.addRuntimeSnapshot({
        id: `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        goalId: `replay:${runId}`,
        runId,
        source: 'replay_command',
        config: {
          deterministicRuntimeEnabled: runtimeConfig.deterministicRuntimeEnabled,
          planCompilerEnabled: runtimeConfig.planCompilerEnabled,
          toolRoutingMode: runtimeConfig.toolRoutingMode,
          runtimeRollout: runtimeConfig.runtimeRollout,
        },
        dryRun: {
          ok: replay.status !== 'failed',
          status: replay.status,
          compileRunId: replaySummary.compile_run_id,
          runtimeRunId: replaySummary.runtime_run_id,
          totalEvents: replaySummary.total_events,
          factsCount: replaySummary.facts_count,
          artifactsCount: replaySummary.artifacts_count,
          reexecution: replay.reexecution
            ? {
              attemptedSteps: replay.reexecution.attempted_steps,
              eligibleSteps: replay.reexecution.eligible_steps,
              executedSteps: replay.reexecution.executed_steps,
              skippedSteps: replay.reexecution.skipped.length,
            }
            : undefined,
          replayPage: {
            returned: replayEventsPage.returned,
            offset: replayEventsPage.offset,
            cursor: replayEventsPage.cursor,
            nextOffset: replayEventsPage.nextOffset,
            nextCursor: replayEventsPage.nextCursor,
          },
        },
      });

      ctx.app.addEvent('runtime.replay.executed', {
        runId,
        relatedRunId,
        mode,
        summary: replay.summary,
        reexecution: replay.reexecution,
        replayEventsPage: {
          returned: replayEventsPage.returned,
          offset: replayEventsPage.offset,
          cursor: replayEventsPage.cursor,
          nextOffset: replayEventsPage.nextOffset,
          nextCursor: replayEventsPage.nextCursor,
        },
      });

      const reexecution = replay.reexecution;
      const reexecutionMessage = reexecution
        ? ` attempted=${reexecution.attempted_steps} eligible=${reexecution.eligible_steps} executed=${reexecution.executed_steps} skipped=${reexecution.skipped.length}`
        : '';

      const paginationMessage = replayEventsPage.nextCursor
        ? ` nextCursor=${replayEventsPage.nextCursor}`
        : '';

      return {
        success: true,
        message: `Replay ${mode} status=${replay.status} events=${replay.summary.total_events}${reexecutionMessage} pageReturned=${replayEventsPage.returned}${paginationMessage}`,
      };
    } catch (err) {
      return { success: false, error: `Replay command failed: ${(err as Error).message}` };
    }
  },

  pruneevents: async (cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    if (cmd.args.length === 0) {
      return {
        success: false,
        error: 'Prune options are required. Usage: /pruneevents beforeTsMs=<ms> [runId=<id>] [runIds=a,b] [eventTypes=a,b] [keepLatestPerRun=n]',
      };
    }

    try {
      const options = parsePruneEventsOptions(cmd.args);
      const result = await client.pruneInternalRunEvents(options);
      ctx.app.addEvent('runtime.events.pruned', {
        ...options,
        deleted: result.deleted,
      });
      return {
        success: true,
        message: `Pruned ${result.deleted} runtime events`,
      };
    } catch (err) {
      return { success: false, error: `Prune command failed: ${(err as Error).message}` };
    }
  },

  // Navigation commands
  dashboard: (_cmd, ctx) => {
    ctx.app.setView('dashboard');
    return { success: true };
  },

  events: (_cmd, ctx) => {
    ctx.app.setView('events');
    return { success: true };
  },

  // Utility commands
  clear: (_cmd, ctx) => {
    ctx.app.clearEvents();
    return { success: true, message: 'Events cleared' };
  },

  exit: (_cmd, ctx) => {
    ctx.exit();
    return { success: true };
  },
};

// Alias mappings
const aliasMap: Record<string, string> = {
  h: 'help',
  '?': 'help',
  n: 'new',
  create: 'new',
  g: 'goals',
  list: 'goals',
  wi: 'workitems',
  items: 'workitems',
  esc: 'escalations',
  e: 'escalations',
  app: 'approvals',
  a: 'approvals',
  s: 'status',
  rc: 'reconnect',
  rf: 'refresh',
  ro: 'rollout',
  rp: 'replay',
  pe: 'pruneevents',
  d: 'dashboard',
  home: 'dashboard',
  ev: 'events',
  cls: 'clear',
  c: 'clear',
  quit: 'exit',
  q: 'exit',
};

/**
 * Execute a command
 */
export async function executeCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const parsed = parseCommand(input);

  if (!parsed) {
    return { success: false, error: 'Invalid command format' };
  }

  const cmdDef = findCommand(parsed.name);
  if (!cmdDef) {
    return { success: false, error: `Unknown command: ${parsed.name}` };
  }

  // Resolve alias to canonical name
  const canonicalName = aliasMap[parsed.name] || parsed.name;
  const handler = handlers[canonicalName];

  if (!handler) {
    return { success: false, error: `No handler for command: ${canonicalName}` };
  }

  try {
    return await handler(parsed, ctx);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Handle natural language input (non-command)
 * Directly creates a goal from the input text
 */
export async function handleNaturalInput(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const client = ctx.gateway.client;
  if (!client) {
    return { success: false, error: 'Not connected to gateway' };
  }

  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  ctx.app.addSimpleMessage({
    id: messageId,
    input,
    status: 'pending',
    timeline: [{ timestamp: Date.now(), stage: 'Parsing intent', detail: 'Analyzing request and planning execution.' }],
    timestamp: Date.now(),
  });

  try {
    ctx.app.setActivityStatus('Creating goal...');

    ctx.app.updateSimpleMessage(messageId, {
      status: 'processing',
      statusText: 'Creating task...',
      timeline: [
        {
          timestamp: Date.now(),
          stage: 'Creating task',
          detail: 'Submitting goal to scheduler.',
        },
      ],
    });

    // Create goal directly from natural language input
    const goal = await client.submitGoal({
      title: input.length > 60 ? input.slice(0, 60) + '...' : input,
      description: input,
      success_criteria: [{
        description: 'Task completed as described',
        type: 'heuristic',
        verification_method: 'human review',
        required: true,
      }],
      priority: 50,
    });

    ctx.app.addGoal(goal);
    ctx.app.addEvent('goal.created', { goalId: goal.id, title: goal.title });
    ctx.app.setActivityStatus('idle');

    ctx.app.updateSimpleMessage(messageId, {
      status: 'processing',
      statusText: 'Queued...',
      goalId: goal.id,
      timeline: [
        {
          timestamp: Date.now(),
          stage: 'Queued',
          detail: 'Waiting for scheduler to start execution.',
        },
      ],
    });

    try {
      const stats = await client.getStats();
      if (stats && typeof stats.schedulerConnected === 'boolean' && !stats.schedulerConnected) {
        ctx.app.updateSimpleMessage(messageId, {
          statusText: 'Queued (scheduler not connected)',
          timeline: [
            {
              timestamp: Date.now(),
              stage: 'Queued',
              detail: 'Scheduler is not connected yet.',
            },
          ],
        });
        ctx.app.addEvent('scheduler.disconnected', { message: 'Scheduler not connected to gateway' });
      }
    } catch {
      // Ignore stats failures
    }

    return { success: true, message: `Goal created: ${goal.title}` };
  } catch (err) {
    ctx.app.setActivityStatus('idle');
    const errorMessage = (err as Error).message;

    ctx.app.updateSimpleMessage(messageId, {
      status: 'failed',
      error: errorMessage,
    });

    return { success: false, error: `Failed to create goal: ${errorMessage}` };
  }
}
