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

type TuiRuntimeConfig = {
  inputBackgroundColor: 'gray' | 'black' | 'blue' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'white';
  sessionFirstEnabled: boolean;
  goalSubmitFastPathEnabled: boolean;
};

function enforceSessionFirstConfig(config: TuiRuntimeConfig): TuiRuntimeConfig {
  return {
    ...config,
    sessionFirstEnabled: true,
    goalSubmitFastPathEnabled: false,
  };
}

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

function parseChannelEventsArgs(args: string[]): {
  limit?: number;
  cursor?: string;
  eventPrefix?: string;
} {
  const [limitArg, cursorArg, prefixArg] = args;
  const result: {
    limit?: number;
    cursor?: string;
    eventPrefix?: string;
  } = {};

  if (limitArg !== undefined) {
    const parsed = Number.parseInt(limitArg, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      throw new Error('limit must be an integer between 1 and 500');
    }
    result.limit = parsed;
  }

  if (cursorArg !== undefined) {
    if (cursorArg.trim().length === 0) {
      throw new Error('cursor must be a non-empty string when provided');
    }
    result.cursor = cursorArg.trim();
  }

  if (prefixArg !== undefined) {
    if (prefixArg.trim().length === 0) {
      throw new Error('eventPrefix must be a non-empty string when provided');
    }
    result.eventPrefix = prefixArg.trim();
  }

  return result;
}

async function refreshSchedulerData(ctx: CommandContext): Promise<CommandResult> {
  const client = ctx.gateway.client;
  if (!client) {
    return { success: false, error: 'Not connected to gateway' };
  }

  ctx.app.setActivityStatus('refreshing scheduler data...');
  try {
    const [goalsResult, workItemsResult, escalationsResult, capabilities] = await Promise.all([
      client.listGoals(ctx.app.state.activeSessionId ? { sessionId: ctx.app.state.activeSessionId } : undefined),
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
      client.listGoals({
        limit: 20,
        ...(ctx.app.state.activeSessionId ? { sessionId: ctx.app.state.activeSessionId } : {}),
      }),
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
  new: async (_cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    try {
      ctx.app.setActivityStatus('Creating session...');
      const session = await client.createConversationSession({});
      ctx.app.setActiveSession(session.sessionId, null);
      ctx.app.selectGoal(null);
      ctx.app.addEvent('conversation.new', {
        sessionId: session.sessionId,
        state: session.state,
        lifecycleState: session.lifecycleState,
      });
      ctx.app.setActivityStatus('idle');
      return { success: true, message: `Session created: ${session.sessionId}` };
    } catch (err) {
      ctx.app.setActivityStatus('idle');
      return { success: false, error: `Failed to create session: ${(err as Error).message}` };
    }
  },

  goals: (_cmd, ctx) => {
    ctx.app.setView('goals');
    return { success: true };
  },

  workstream: (_cmd, ctx) => {
    ctx.app.setView('tasks');
    return { success: true };
  },

  sessions: async (cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    const archivedOnly = cmd.args.includes('--archived-only');
    const activeOnly = cmd.args.includes('--active-only');
    const withoutFlags = cmd.args.filter((arg) => arg !== '--archived-only' && arg !== '--active-only');
    const stateArg = withoutFlags[0];
    const lifecycleStateFromArg = stateArg === 'active' || stateArg === 'archived' ? stateArg : undefined;
    const lifecycleState = archivedOnly ? 'archived' : activeOnly ? 'active' : lifecycleStateFromArg;
    const normalizedArgs = lifecycleStateFromArg ? withoutFlags.slice(1) : withoutFlags;
    const limitCandidate = normalizedArgs[0] ? Number.parseInt(normalizedArgs[0], 10) : NaN;
    const limit = Number.isFinite(limitCandidate) ? Math.max(1, Math.min(100, limitCandidate)) : 20;
    const queryArg = Number.isFinite(limitCandidate)
      ? normalizedArgs.slice(1).join(' ').trim()
      : normalizedArgs.join(' ').trim();
    try {
      const result = await client.listConversationSessions(
        lifecycleState ? { lifecycleState, limit } : { limit }
      );
      ctx.app.setSessions(
        result.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          state: session.state,
          lifecycleState: session.lifecycleState,
          archivedAt: session.archivedAt,
          archiveSummary: session.archiveSummary,
          turnCount: session.turnCount,
          lastMessage: session.lastMessage,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }))
      );

      ctx.app.addEvent('conversation.sessions.loaded', {
        count: result.sessions.length,
        lifecycleState,
        limit,
      });
      ctx.app.setSessionsViewState(lifecycleState ?? ctx.app.state.sessionsLifecycleFilter, queryArg || '');
      ctx.app.setView('sessions');

      return { success: true, message: `Loaded ${result.sessions.length} sessions (limit ${limit})` };
    } catch (err) {
      return { success: false, error: `Failed to load sessions: ${(err as Error).message}` };
    }
  },

  use: async (cmd, ctx) => {
    const [sessionIdArg] = cmd.args;
    if (!sessionIdArg) {
      return { success: false, error: 'Session ID is required. Usage: /use <sessionId>' };
    }

    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    const sessionId = (() => {
      const exact = ctx.app.state.sessions.find((session) => session.id === sessionIdArg);
      if (exact) return exact.id;
      const prefixMatches = ctx.app.state.sessions.filter((session) => session.id.startsWith(sessionIdArg));
      if (prefixMatches.length === 1) return prefixMatches[0].id;
      const titleMatches = ctx.app.state.sessions.filter((session) =>
        (session.title || '').toLowerCase().includes(sessionIdArg.toLowerCase())
      );
      if (titleMatches.length === 1) return titleMatches[0].id;
      return null;
    })();

    if (!sessionId) {
      const prefixMatches = ctx.app.state.sessions.filter((session) => session.id.startsWith(sessionIdArg));
      if (prefixMatches.length > 1) {
        return {
          success: false,
          error: `Ambiguous session prefix '${sessionIdArg}'. Matches: ${prefixMatches
            .slice(0, 5)
            .map((s) => s.id.slice(0, 12))
            .join(', ')}`,
        };
      }
      const titleMatches = ctx.app.state.sessions.filter((session) =>
        (session.title || '').toLowerCase().includes(sessionIdArg.toLowerCase())
      );
      if (titleMatches.length > 1) {
        return {
          success: false,
          error: `Ambiguous session title '${sessionIdArg}'. Matches: ${titleMatches
            .slice(0, 5)
            .map((s) => (s.title || s.id).slice(0, 20))
            .join(', ')}`,
        };
      }
      return { success: false, error: `Session not found: ${sessionIdArg}` };
    }

    try {
      const status = await client.getConversationStatus(sessionId);
      if (!status.exists) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }

      const summary = ctx.app.state.sessions.find((session) => session.id === sessionId);
      ctx.app.setActiveSession(sessionId, summary?.title ?? null);
      ctx.app.selectGoal(null);
      ctx.app.addEvent('conversation.session.selected', {
        sessionId,
        state: status.state,
        lifecycleState: status.lifecycleState,
      });

      return { success: true, message: `Active session: ${sessionId}` };
    } catch (err) {
      return { success: false, error: `Failed to switch session: ${(err as Error).message}` };
    }
  },

  'archive-session': async (cmd, ctx) => {
    const [sessionId] = cmd.args;
    if (!sessionId) {
      return { success: false, error: 'Session ID is required. Usage: /archive-session <sessionId>' };
    }

    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    try {
      const result = await client.archiveConversationSession(sessionId);
      if (!result.success) {
        return { success: false, error: `Failed to archive session: ${sessionId}` };
      }

      const sessions = await client.listConversationSessions({ limit: 20, lifecycleState: 'active' });
      ctx.app.setSessions(sessions.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        state: session.state,
        lifecycleState: session.lifecycleState,
        archivedAt: session.archivedAt,
        archiveSummary: session.archiveSummary,
        turnCount: session.turnCount,
        lastMessage: session.lastMessage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })));

      if (ctx.app.state.activeSessionId === sessionId) {
        ctx.app.setActiveSession(null, null);
      }

      ctx.app.addEvent('conversation.archived', {
        sessionId,
        archivedAt: result.archivedAt,
      });
      ctx.app.setSessionsViewState('active', ctx.app.state.sessionsSearchQuery);
      ctx.app.setView('sessions');
      return { success: true, message: `Archived session: ${sessionId}` };
    } catch (err) {
      return { success: false, error: `Failed to archive session: ${(err as Error).message}` };
    }
  },

  'resume-session': async (cmd, ctx) => {
    const [sessionId] = cmd.args;
    if (!sessionId) {
      return { success: false, error: 'Session ID is required. Usage: /resume-session <sessionId>' };
    }

    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    try {
      const result = await client.resumeConversationSession(sessionId);
      if (!result.success) {
        return { success: false, error: `Failed to resume session: ${sessionId}` };
      }

      const sessions = await client.listConversationSessions({ limit: 20, lifecycleState: 'active' });
      ctx.app.setSessions(sessions.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        state: session.state,
        lifecycleState: session.lifecycleState,
        archivedAt: session.archivedAt,
        archiveSummary: session.archiveSummary,
        turnCount: session.turnCount,
        lastMessage: session.lastMessage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })));

      const resumedSummary = sessions.sessions.find((session) => session.id === sessionId);
      ctx.app.setActiveSession(sessionId, resumedSummary?.title ?? null);
      ctx.app.addEvent('conversation.resumed', { sessionId });
      ctx.app.setSessionsViewState('active', ctx.app.state.sessionsSearchQuery);
      ctx.app.setView('sessions');
      return { success: true, message: `Resumed session: ${sessionId}` };
    } catch (err) {
      return { success: false, error: `Failed to resume session: ${(err as Error).message}` };
    }
  },

  'session-history': async (cmd, ctx) => {
    const args = [...cmd.args];
    let cursor = 0;

    const maybeSessionArg = args[cursor];
    const hasSessionShape = !!maybeSessionArg && (
      maybeSessionArg.includes('-') ||
      ctx.app.state.sessions.some((session) => session.id.startsWith(maybeSessionArg))
    );

    const sessionId = hasSessionShape ? maybeSessionArg! : ctx.app.state.activeSessionId;
    if (hasSessionShape) cursor += 1;

    if (!sessionId) {
      return { success: false, error: 'Session ID is required. Usage: /session-history [sessionId] [limit] [role] [offset]' };
    }

    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    const limitArg = args[cursor];
    const parsed = limitArg ? Number.parseInt(limitArg, 10) : 20;
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 20;
    if (Number.isFinite(parsed)) cursor += 1;

    const roleArg = args[cursor];
    const roleFilter = roleArg === 'user' || roleArg === 'assistant' || roleArg === 'system' ? roleArg : 'all';
    if (roleFilter !== 'all') cursor += 1;

    const offsetArg = args[cursor];
    const parsedOffset = offsetArg ? Number.parseInt(offsetArg, 10) : 0;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    if (Number.isFinite(parsedOffset)) cursor += 1;

    const previewLinesArg = args[cursor];
    const parsedPreviewLines = previewLinesArg ? Number.parseInt(previewLinesArg, 10) : 8;
    const previewLines = Number.isFinite(parsedPreviewLines)
      ? Math.max(1, Math.min(20, parsedPreviewLines))
      : 8;

    try {
      const history = await client.getConversationHistory(sessionId, limit);
      const roleFiltered = roleFilter === 'all'
        ? history.turns
        : history.turns.filter((turn) => turn.role === roleFilter);
      const endExclusive = Math.max(0, roleFiltered.length - offset);
      const startInclusive = Math.max(0, endExclusive - limit);
      const windowTurns = roleFiltered.slice(startInclusive, endExclusive);
      const previewTurns = windowTurns.slice(-previewLines);
      const historyText = previewTurns
        .map((turn) => `${turn.role}: ${turn.content.replace(/\s+/g, ' ').slice(0, 140)}`)
        .join('\n');

      ctx.app.addEvent('conversation.history.loaded', {
        sessionId,
        total: history.turns.length,
        returned: roleFiltered.length,
        limit,
        offset,
        previewLines,
        roleFilter,
      });

      ctx.app.setSessionHistoryPreview({
        sessionId,
        totalTurns: history.turns.length,
        returnedTurns: roleFiltered.length,
        roleFilter,
        limit,
        offset,
        previewLines,
        generatedAt: Date.now(),
        source: 'command',
        previewText: historyText || 'No turns in session history.',
      });

      ctx.app.addSimpleMessage({
        id: `session-history-${sessionId}-${Date.now()}`,
        input: `Session history ${sessionId}`,
        status: 'completed',
        statusText: `Loaded ${history.turns.length} turns`,
        timeline: [
          {
            timestamp: Date.now(),
            stage: 'History',
            detail: `Fetched ${history.turns.length} turns for session ${sessionId}.`,
          },
        ],
        resultSummary: historyText || 'No turns in session history.',
        timestamp: Date.now(),
      });

      return { success: true, message: `Loaded history for session ${sessionId}` };
    } catch (err) {
      return { success: false, error: `Failed to load session history: ${(err as Error).message}` };
    }
  },

  'sessions-reset': (_cmd, ctx) => {
    ctx.app.setSessionsViewState('active', '', 'updated');
    ctx.app.addEvent('conversation.sessions.reset', { source: 'command' });
    ctx.app.setView('sessions');
    return { success: true, message: 'Sessions view state reset' };
  },

  'session-history-clear': (_cmd, ctx) => {
    ctx.app.clearAllSessionHistoryPreviews();
    ctx.app.addEvent('conversation.history.cleared', { source: 'command' });
    return { success: true, message: 'Cleared all session history previews' };
  },

  'sessions-export': (_cmd, ctx) => {
    const payload = {
      exportedAt: Date.now(),
      count: ctx.app.state.sessions.length,
      sessions: ctx.app.state.sessions,
    };
    ctx.app.addSimpleMessage({
      id: `sessions-export-${Date.now()}`,
      input: '/sessions-export',
      status: 'completed',
      statusText: `Exported ${payload.count} sessions`,
      timeline: [{ timestamp: Date.now(), stage: 'Export', detail: 'Exported session summary JSON' }],
      resultSummary: JSON.stringify(payload, null, 2),
      timestamp: Date.now(),
    });
    return { success: true, message: `Exported ${payload.count} sessions` };
  },

  'events-export': (cmd, ctx) => {
    const parsedLimit = cmd.args[0] ? Number.parseInt(cmd.args[0], 10) : 50;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(500, parsedLimit)) : 50;

    const scoped = (() => {
      const filter = ctx.app.state.eventsFilter;
      if (filter === 'all') return ctx.app.state.events;
      if (filter === 'conversation') return ctx.app.state.events.filter((e) => e.event.startsWith('conversation.'));
      return ctx.app.state.events.filter((e) => e.event.startsWith(filter));
    })();

    const query = ctx.app.state.eventsSearchQuery.trim().toLowerCase();
    const filtered = query
      ? scoped.filter((e) => {
          const data = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
          return `${e.event} ${data}`.toLowerCase().includes(query);
        })
      : scoped;

    const selected = filtered.slice(-limit);
    const payload = {
      exportedAt: Date.now(),
      filter: ctx.app.state.eventsFilter,
      searchQuery: ctx.app.state.eventsSearchQuery,
      limit,
      count: selected.length,
      events: selected,
    };

    ctx.app.addSimpleMessage({
      id: `events-export-${Date.now()}`,
      input: '/events-export',
      status: 'completed',
      statusText: `Exported ${selected.length} events`,
      timeline: [{ timestamp: Date.now(), stage: 'Export', detail: 'Exported filtered event JSON' }],
      resultSummary: JSON.stringify(payload, null, 2),
      timestamp: Date.now(),
    });

    return { success: true, message: `Exported ${selected.length} events` };
  },

  'events-reset': (_cmd, ctx) => {
    ctx.app.setEventsViewState('all', '');
    ctx.app.addEvent('events.reset', { source: 'command' });
    ctx.app.setView('events');
    return { success: true, message: 'Events view state reset' };
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
    const [goalId, ...reasonParts] = cmd.args;
    if (!goalId) {
      return { success: false, error: 'Goal ID is required. Usage: /cancel <id>' };
    }
    const reason = reasonParts.join(' ').trim();

    ctx.app.openModal('confirm', {
      title: 'Cancel Goal',
      message: `Are you sure you want to cancel goal ${goalId}?`,
      onConfirm: async () => {
        try {
          const client = ctx.gateway.client;
          if (client) {
            await client.cancelGoal(goalId, reason || undefined);
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
        if (goalId) {
          ctx.app.selectGoal(goalId);
        }
        ctx.app.setView('tasks');
        ctx.app.addEvent('workitems.loaded', { count: result.workItems.length });
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    return { success: true };
  },

  retry: async (cmd, ctx) => {
    const [workItemId] = cmd.args;
    if (!workItemId) {
      return { success: false, error: 'Work item ID is required. Usage: /retry <workItemId>' };
    }

    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    try {
      const result = await client.retryWorkItem({ workItemId });
      ctx.app.updateWorkItem(result.workItem);
      ctx.app.addEvent('workitem.retry_requested', { workItemId, status: result.workItem.status });
      return { success: true, message: `Retry requested for ${workItemId}` };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
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

  channels: async (_cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    try {
      const status = await client.getChannelsStatus();
      ctx.app.addEvent('system.channels.status', status);
      return {
        success: true,
        message: `Channels enabled=[${status.enabledChannels.join(', ')}], mirrorAll=${String(status.mirrorToAllEnabledChannels)}, adapters running=${status.adapterHealth.running} error=${status.adapterHealth.error}`,
      };
    } catch (err) {
      return { success: false, error: `Channels command failed: ${(err as Error).message}` };
    }
  },

  'channel-events': async (cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    try {
      const params = parseChannelEventsArgs(cmd.args);
      const page = await client.getChannelEvents(params);
      ctx.app.addEvent('system.channels.events.loaded', {
        returned: page.events.length,
        nextCursor: page.nextCursor,
        params,
      });
      return {
        success: true,
        message: `Channel events loaded: returned=${page.events.length}${page.nextCursor ? ` nextCursor=${page.nextCursor}` : ''}`,
      };
    } catch (err) {
      return { success: false, error: `Channel events command failed: ${(err as Error).message}` };
    }
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

  models: async (_cmd, ctx) => {
    const models = ctx.app.state.schedulerCapabilities?.capabilities.models ?? [];
    if (models.length === 0) {
      return { success: false, error: 'No models available. Try /refresh first.' };
    }

    ctx.app.openModal('model-selector', {
      selectedModel: ctx.app.state.selectedModel,
      onSelect: (model: string | null) => {
        ctx.app.setSelectedModel(model);
        ctx.app.addEvent('model.selected', { model: model ?? 'AUTO', source: 'slash_command' });
        const clientForPersist = ctx.gateway.client;
        if (!clientForPersist) {
          ctx.app.addEvent('model.selection.persist_failed', {
            model: model ?? 'AUTO',
            error: 'Not connected to gateway',
          });
          return;
        }

        const activeAgentId = ctx.app.state.selectedAgentId
          ?? ctx.app.state.schedulerCapabilities?.capabilities.agents?.[0]?.id;
        if (!activeAgentId) {
          ctx.app.addEvent('model.selection.persist_failed', {
            model: model ?? 'AUTO',
            error: 'No active agent selected',
          });
          return;
        }

        void clientForPersist.setAgentModelOverride({
          agentId: activeAgentId,
          model: model ?? 'AUTO',
        })
          .then((result) => {
            ctx.app.addEvent('model.selection.persisted', {
              model: result.model,
              agentId: result.agentId,
              configPath: result.configPath,
            });
          })
          .catch((error) => {
            ctx.app.addEvent('model.selection.persist_failed', {
              model: model ?? 'AUTO',
              error: (error as Error).message,
            });
          });
      },
    });

    return { success: true, message: 'Opened model selector' };
  },

  'input-mode': async (cmd, ctx) => {
    const client = ctx.gateway.client;
    if (!client) {
      return { success: false, error: 'Not connected to gateway' };
    }

    const runtime = await client.getInternalRuntimeConfig();
    const effective = enforceSessionFirstConfig(runtime.tui);
    const arg = cmd.args[0]?.toLowerCase();

    if (!arg) {
      return {
        success: true,
        message: `Current input mode: session-first (sessionFirstEnabled=${String(effective.sessionFirstEnabled)}, goalSubmitFastPathEnabled=${String(effective.goalSubmitFastPathEnabled)})`,
      };
    }

    if (arg !== 'session-first') {
      return { success: false, error: 'Only session-first mode is supported' };
    }

    const updatedTui = enforceSessionFirstConfig(await client.updateRuntimeTuiConfig({
      sessionFirstEnabled: true,
      goalSubmitFastPathEnabled: false,
    }));
    ctx.app.setRuntimeTuiConfig(updatedTui);

    ctx.app.addEvent('tui.input_mode.updated', {
      mode: 'session-first',
      sessionFirstEnabled: updatedTui.sessionFirstEnabled,
      goalSubmitFastPathEnabled: updatedTui.goalSubmitFastPathEnabled,
    });

    return { success: true, message: 'Input mode switched to session-first' };
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
        const sessionFirst = status.metrics.sessionFirst;
        const sessionSummary = sessionFirst
          ? ` sessionCreate=${Math.round(sessionFirst.sessionCreationSuccessRate * 100)}% msgSuccess=${Math.round(sessionFirst.conversationMessageSuccessRate * 100)}% goalCoverage=${Math.round(sessionFirst.goalSessionCoverageRate * 100)}% runSuccess=${Math.round(sessionFirst.runSuccessRate * 100)}%`
          : '';
        return {
          success: true,
          message: `Rollout mode=${status.mode}, shadow=${String(status.rollout.shadowModeEnabled)}, canary=${status.rollout.canaryPercent}% dryRuns=${status.metrics.dryRunsTotal}${sessionSummary}`,
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
  ss: 'sessions',
  session: 'use',
  as: 'archive-session',
  rs: 'resume-session',
  sh: 'session-history',
  srst: 'sessions-reset',
  shex: 'sessions-export',
  eex: 'events-export',
  erst: 'events-reset',
  shc: 'session-history-clear',
  g: 'goals',
  list: 'goals',
  wi: 'workitems',
  items: 'workitems',
  rt: 'retry',
  esc: 'escalations',
  e: 'escalations',
  app: 'approvals',
  a: 'approvals',
  s: 'status',
  ch: 'channels',
  chev: 'channel-events',
  rc: 'reconnect',
  rf: 'refresh',
  modelpicker: 'models',
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
  im: 'input-mode',
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

export async function handleNaturalInput(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  const client = ctx.gateway.client;
  if (!client) {
    return { success: false, error: 'Not connected to gateway' };
  }

  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const activeSessionId = ctx.app.state.activeSessionId;
  const runtimeConfig = enforceSessionFirstConfig(
    (ctx.app.state.runtimeTuiConfig ?? (await client.getInternalRuntimeConfig()).tui) as TuiRuntimeConfig
  );
  if (!ctx.app.state.runtimeTuiConfig) {
    ctx.app.setRuntimeTuiConfig(runtimeConfig);
  }

  ctx.app.addSimpleMessage({
    id: messageId,
    input,
    source: 'conversation',
    sessionId: activeSessionId ?? undefined,
    status: 'pending',
    timeline: [{ timestamp: Date.now(), stage: 'Parsing intent', detail: 'Analyzing request and planning execution.' }],
    timestamp: Date.now(),
  });

  try {
    ctx.app.addEvent('tui.input_mode.used', { mode: 'session-first' });
    ctx.app.setActivityStatus('Processing conversation...');

    ctx.app.updateSimpleMessage(messageId, {
      status: 'processing',
      statusText: 'Analyzing intent...',
      timeline: [
        {
          timestamp: Date.now(),
          stage: 'Conversation',
          detail: 'Submitting message to conversation session.',
        },
      ],
    });

    const sessionPayload = activeSessionId
      ? { sessionId: activeSessionId }
      : await client.createConversationSession({});
    const sessionId = sessionPayload.sessionId;

    ctx.app.updateSimpleMessage(messageId, {
      sessionId,
      source: 'conversation',
    });

    if (!ctx.app.state.activeSessionId) {
      const inferredTitle = input.length > 60 ? `${input.slice(0, 60)}...` : input;
      ctx.app.setActiveSession(sessionId, inferredTitle);
      ctx.app.addEvent('conversation.new', {
        sessionId,
        source: 'natural_input_auto_create',
      });
    } else if (!ctx.app.state.activeSessionTitle) {
      const inferredTitle = input.length > 60 ? `${input.slice(0, 60)}...` : input;
      ctx.app.setActiveSession(sessionId, inferredTitle);
    }

    const conversationResult = await client.sendConversationMessage({
      sessionId,
      message: input,
      stream: false,
    });

    ctx.app.addEvent('conversation.response', {
      sessionId: conversationResult.sessionId,
      state: conversationResult.state,
      decision: conversationResult.decision,
      decisionReason: conversationResult.decisionReason,
      hasTask: !!conversationResult.taskInfo,
    });

    ctx.app.setActivityStatus('idle');

    if (conversationResult.taskInfo?.goalId) {
      ctx.app.selectGoal(conversationResult.taskInfo.goalId);
      ctx.app.updateSimpleMessage(messageId, {
        status: 'processing',
        statusText: 'Task queued...',
        goalId: conversationResult.taskInfo.goalId,
        timeline: [
          {
            timestamp: Date.now(),
            stage: 'Task created',
            detail: `Goal ${conversationResult.taskInfo.goalId} created from conversation intent.`,
          },
        ],
      });

      try {
        const stats = await client.getStats();
        if (stats && typeof stats.schedulerConnected === 'boolean' && !stats.schedulerConnected) {
          ctx.app.updateSimpleMessage(messageId, {
            statusText: 'Task queued (scheduler not connected)',
          });
          ctx.app.addEvent('scheduler.disconnected', { message: 'Scheduler not connected to gateway' });
        }
      } catch {
        // Ignore stats failures
      }
    } else {
      ctx.app.updateSimpleMessage(messageId, {
        status: 'completed',
        statusText: 'Conversation response ready',
        resultSummary: conversationResult.response,
        actions: extractActionHints(conversationResult.response),
        timeline: [
          {
            timestamp: Date.now(),
            stage: 'Response',
            detail: 'No executable goal created for this turn.',
          },
        ],
      });
    }

    return {
      success: true,
      message: conversationResult.taskInfo?.goalId
        ? `Goal created from session ${conversationResult.sessionId}`
        : `Response generated in session ${conversationResult.sessionId}`,
    };
  } catch (err) {
    ctx.app.setActivityStatus('idle');
    const errorMessage = (err as Error).message;

    ctx.app.updateSimpleMessage(messageId, {
      status: 'failed',
      error: errorMessage,
    });

    return { success: false, error: `Conversation failed: ${errorMessage}` };
  }
}

function extractActionHints(text: string): Array<{ label: string; kind: 'file' | 'url' | 'command'; target: string }> {
  const result: Array<{ label: string; kind: 'file' | 'url' | 'command'; target: string }> = [];
  const seen = new Set<string>();

  const urls = text.match(/https?:\/\/[^\s)]+/g) || [];
  for (const url of urls.slice(0, 6)) {
    if (seen.has(url)) continue;
    seen.add(url);
    result.push({ label: `Open URL: ${url}`, kind: 'url', target: url });
  }

  const files = text.match(/(?:\.|\/|~\/)[\w./-]+\.[\w]+/g) || [];
  for (const filePath of files.slice(0, 6)) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    result.push({ label: `Open file: ${filePath}`, kind: 'file', target: filePath });
  }

  return result;
}
