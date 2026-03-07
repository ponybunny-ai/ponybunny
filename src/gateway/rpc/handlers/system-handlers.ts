import type { RpcHandler } from '../rpc-handler.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConnectionManager } from '../../connection/connection-manager.js';
import type { ChannelRouter, GatewayChannelType } from '../../channels/channel-router.js';
import type { GatewayChannelAdapterStatus } from '../../channels/channel-adapter.js';
import type { GatewayChannelAdapterConfig } from '../../channels/channel-adapter-config.js';
import { normalizeAdapterConfig, sanitizeAdapterConfig } from '../../channels/channel-adapter-config.js';
import type { StoredChannelEvent } from '../../channels/channel-event-store.js';
import type { ISchedulerCore } from '../../../scheduler/core/index.js';
import type { ToolRegistry } from '../../../infra/tools/tool-registry.js';
import {
  getSystemInfo,
  getAllProcessInfo,
  type SystemInfo,
  type GatewayProcessInfo,
  type SchedulerProcessInfo,
} from '../../system/system-info.js';
import {
  getSchedulerCapabilities,
  type SchedulerCapabilities,
} from '../../../infra/scheduler/capabilities.js';
import { GatewayError } from '../../errors.js';
import { loadRuntimeConfig, saveRuntimeConfig } from '../../../infra/config/runtime-config.js';
import { getUserAgentsDir } from '../../../infra/agents/agent-discovery.js';
import type { RuntimeRolloutMetricsSnapshot } from '../../runtime/runtime-rollout-telemetry.js';

export interface SystemStatusResponse {
  timestamp: number;
  system: SystemInfo;
  processes: {
    current: {
      pid: number;
      uptime: number;
      memory: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
      };
      cpu: {
        user: number;
        system: number;
      };
    };
    gateway: GatewayProcessInfo;
    scheduler: SchedulerProcessInfo;
  };
  gateway: {
    isRunning: boolean;
    connections: {
      total: number;
      authenticated: number;
      pending: number;
      byIp: Record<string, number>;
    };
    daemonConnected: boolean;
    schedulerConnected: boolean;
    realtime: {
      schedulerCommandAckMsP95: number;
      streamChunkLatencyMsP95: number;
      ackSampleSize: number;
      streamSampleSize: number;
    };
  };
  scheduler: {
    isConnected: boolean;
    state?: {
      status: string;
      activeGoals: string[];
      lastTickAt?: number;
      errorCount: number;
    };
    metrics?: {
      goalsProcessed: number;
      workItemsCompleted: number;
      totalTokensUsed: number;
      averageCompletionTime: number;
    };
    capabilities?: SchedulerCapabilities;
  };
  runtimeRollout: RuntimeRolloutStatusResponse;
}

export interface SystemCapabilitiesResponse {
  timestamp: number;
  schedulerConnected: boolean;
  capabilities: SchedulerCapabilities;
}

export interface RuntimeRolloutStatusResponse {
  mode: 'legacy' | 'shadow' | 'canary';
  schedulerFlags: {
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  };
  rollout: {
    shadowModeEnabled: boolean;
    canaryPercent: number;
    rollbackOnFailure: boolean;
    lanePercents: {
      dryRun: number;
      compile: number;
      replay: number;
    };
  };
  metrics: RuntimeRolloutMetricsSnapshot;
}

export interface RuntimeRolloutUpdateParams {
  shadowModeEnabled?: boolean;
  canaryPercent?: number;
  lanePercents?: {
    dryRun?: number;
    compile?: number;
    replay?: number;
  };
  rollbackOnFailure?: boolean;
  rollbackToLegacy?: boolean;
}

export interface RuntimeTuiConfigUpdateParams {
  sessionFirstEnabled?: boolean;
  goalSubmitFastPathEnabled?: boolean;
  inputBackgroundColor?: 'gray' | 'black' | 'blue' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'white';
}

export interface RuntimeTuiConfigResponse {
  inputBackgroundColor: 'gray' | 'black' | 'blue' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'white';
  sessionFirstEnabled: boolean;
  goalSubmitFastPathEnabled: boolean;
}

export interface GatewayChannelsStatusResponse {
  enabledChannels: GatewayChannelType[];
  mirrorToAllEnabledChannels: boolean;
  adapters: GatewayChannelAdapterStatus[];
  adapterHealth: {
    total: number;
    running: number;
    stopped: number;
    error: number;
    available: number;
  };
  adapterRecentFailures: Array<{
    channel: GatewayChannelType;
    timestamp: number;
    attempt: number;
    error: string;
    reason: 'startup' | 'rpc-update' | 'channel-toggle' | 'shutdown';
    source: 'gateway-startup' | 'rpc-system.channels.update' | 'channel-router' | 'gateway-stop';
  }>;
}

export interface GatewayChannelsUpdateParams {
  enabledChannels?: GatewayChannelType[];
  mirrorToAllEnabledChannels?: boolean;
  sessionChannelOverrides?: Array<{ sessionId: string; channel: GatewayChannelType }>;
  clearSessionChannelOverrides?: string[];
  adapterConfigs?: Partial<Record<GatewayChannelType, GatewayChannelAdapterConfig>>;
}

export interface GatewayChannelEventsParams {
  eventPrefix?: string;
  eventNames?: string[];
  channelType?: GatewayChannelType;
  channelSessionId?: string;
  sessionId?: string;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  sinceTimestamp?: number;
  cursor?: string;
  limit?: number;
}

export interface GatewayChannelEventsResponse {
  events: StoredChannelEvent[];
  nextCursor?: string;
}

export interface SetMainAgentModelHintParams {
  model: string;
}

export interface SetMainAgentModelHintResponse {
  success: boolean;
  agentId: string;
  model: string;
  configPath: string;
}

export interface SystemHandlersOptions {
  getRuntimeRolloutMetrics?: () => RuntimeRolloutMetricsSnapshot;
  getSessionGoalCoverage?: () => {
    goalsTotal: number;
    goalsWithSessionLink: number;
    goalSessionCoverageRate: number;
  };
  applyRuntimeRollout?: (rollout: {
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
    runtimeRollout: RuntimeRolloutStatusResponse['rollout'];
  }) => Promise<void>;
}

const EMPTY_RUNTIME_ROLLOUT_METRICS: RuntimeRolloutMetricsSnapshot = {
  dryRunsTotal: 0,
  dryRunsSucceeded: 0,
  dryRunsFailed: 0,
  successRate: 0,
  averagePlanStepCount: 0,
  averageChangedStepCount: 0,
  failureCodeCounts: {},
  retentionRunsTotal: 0,
  retentionDeletedTotal: 0,
  retentionFailedTotal: 0,
  sessionFirst: {
    sessionCreationsTotal: 0,
    sessionCreationsSucceeded: 0,
    sessionCreationSuccessRate: 0,
    conversationMessagesTotal: 0,
    conversationMessagesSucceeded: 0,
    conversationMessagesFailed: 0,
    conversationMessageSuccessRate: 0,
    goalsTotal: 0,
    goalsWithSessionLink: 0,
    goalSessionCoverageRate: 0,
    runsTotal: 0,
    runsSucceeded: 0,
    runsFailed: 0,
    runSuccessRate: 0,
    averageRunLatencyMs: 0,
  },
};

function toRuntimeRolloutUpdatePayload(runtime: ReturnType<typeof loadRuntimeConfig>): {
  deterministicRuntimeEnabled: boolean;
  planCompilerEnabled: boolean;
  toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout: RuntimeRolloutStatusResponse['rollout'];
} {
  return {
    deterministicRuntimeEnabled: runtime.scheduler.deterministicRuntimeEnabled,
    planCompilerEnabled: runtime.scheduler.planCompilerEnabled,
    toolRoutingMode: runtime.scheduler.toolRoutingMode,
    runtimeRollout: {
      shadowModeEnabled: runtime.scheduler.runtimeRollout.shadowModeEnabled,
      canaryPercent: runtime.scheduler.runtimeRollout.canaryPercent,
      rollbackOnFailure: runtime.scheduler.runtimeRollout.rollbackOnFailure,
      lanePercents: {
        dryRun: runtime.scheduler.runtimeRollout.lanePercents.dryRun,
        compile: runtime.scheduler.runtimeRollout.lanePercents.compile,
        replay: runtime.scheduler.runtimeRollout.lanePercents.replay,
      },
    },
  };
}

function determineRolloutMode(
  shadowModeEnabled: boolean,
  canaryPercent: number,
  lanePercents: RuntimeRolloutStatusResponse['rollout']['lanePercents']
): RuntimeRolloutStatusResponse['mode'] {
  if (shadowModeEnabled) {
    return 'shadow';
  }

  const laneMax = Math.max(lanePercents.dryRun, lanePercents.compile, lanePercents.replay);
  if (canaryPercent > 0 || laneMax > 0) {
    return 'canary';
  }

  return 'legacy';
}

function toCanaryPercent(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100) {
    return value;
  }

  throw GatewayError.invalidParams(`canaryPercent must be an integer between 0 and 100 (current=${fallback})`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalBoolean(record: Record<string, unknown>, key: string, channel: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  throw GatewayError.invalidParams(`adapterConfigs.${channel}.${key} must be a boolean`);
}

function readOptionalString(record: Record<string, unknown>, key: string, channel: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw GatewayError.invalidParams(`adapterConfigs.${channel}.${key} must be a string`);
}

function readOptionalInteger(
  record: Record<string, unknown>,
  key: string,
  channel: string,
  min: number,
  max: number
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  throw GatewayError.invalidParams(`adapterConfigs.${channel}.${key} must be an integer between ${min} and ${max}`);
}

function validateAdapterConfigForChannel(
  channel: GatewayChannelType,
  config: GatewayChannelAdapterConfig
): GatewayChannelAdapterConfig {
  const input = isRecord(config) ? config : {};
  const retryAttempts = readOptionalInteger(input, 'retryAttempts', channel, 1, 5);
  const retryBackoffMs = readOptionalInteger(input, 'retryBackoffMs', channel, 0, 10000);
  const retryFields = {
    ...(retryAttempts !== undefined ? { retryAttempts } : {}),
    ...(retryBackoffMs !== undefined ? { retryBackoffMs } : {}),
  };

  if (channel === 'discord') {
    return normalizeAdapterConfig(channel, {
      ...(readOptionalString(input, 'botToken', channel) !== undefined ? { botToken: readOptionalString(input, 'botToken', channel) } : {}),
      ...(readOptionalString(input, 'webhookUrl', channel) !== undefined ? { webhookUrl: readOptionalString(input, 'webhookUrl', channel) } : {}),
      ...(readOptionalString(input, 'guildId', channel) !== undefined ? { guildId: readOptionalString(input, 'guildId', channel) } : {}),
      ...(readOptionalString(input, 'applicationId', channel) !== undefined ? { applicationId: readOptionalString(input, 'applicationId', channel) } : {}),
      ...(readOptionalBoolean(input, 'commandsEnabled', channel) !== undefined
        ? { commandsEnabled: readOptionalBoolean(input, 'commandsEnabled', channel) }
        : {}),
      ...retryFields,
    });
  }

  if (channel === 'telegram') {
    return normalizeAdapterConfig(channel, {
      ...(readOptionalString(input, 'botToken', channel) !== undefined ? { botToken: readOptionalString(input, 'botToken', channel) } : {}),
      ...(readOptionalString(input, 'webhookUrl', channel) !== undefined ? { webhookUrl: readOptionalString(input, 'webhookUrl', channel) } : {}),
      ...(readOptionalBoolean(input, 'pollingEnabled', channel) !== undefined
        ? { pollingEnabled: readOptionalBoolean(input, 'pollingEnabled', channel) }
        : {}),
      ...retryFields,
    });
  }

  if (channel === 'email') {
    return normalizeAdapterConfig(channel, {
      ...(readOptionalString(input, 'inboundAddress', channel) !== undefined
        ? { inboundAddress: readOptionalString(input, 'inboundAddress', channel) }
        : {}),
      ...(readOptionalString(input, 'smtpHost', channel) !== undefined ? { smtpHost: readOptionalString(input, 'smtpHost', channel) } : {}),
      ...(readOptionalInteger(input, 'smtpPort', channel, 1, 65535) !== undefined
        ? { smtpPort: readOptionalInteger(input, 'smtpPort', channel, 1, 65535) }
        : {}),
      ...(readOptionalBoolean(input, 'useTls', channel) !== undefined ? { useTls: readOptionalBoolean(input, 'useTls', channel) } : {}),
      ...retryFields,
    });
  }

  if (channel === 'webui') {
    return normalizeAdapterConfig(channel, {
      ...(readOptionalString(input, 'origin', channel) !== undefined ? { origin: readOptionalString(input, 'origin', channel) } : {}),
      ...(readOptionalBoolean(input, 'corsEnabled', channel) !== undefined
        ? { corsEnabled: readOptionalBoolean(input, 'corsEnabled', channel) }
        : {}),
      ...retryFields,
    });
  }

  if (channel === 'whatsapp') {
    const provider = readOptionalString(input, 'provider', channel);
    if (provider !== undefined && provider !== 'meta' && provider !== 'twilio') {
      throw GatewayError.invalidParams('adapterConfigs.whatsapp.provider must be one of: meta, twilio');
    }

    return normalizeAdapterConfig(channel, {
      ...(provider !== undefined ? { provider } : {}),
      ...(readOptionalString(input, 'phoneNumberId', channel) !== undefined
        ? { phoneNumberId: readOptionalString(input, 'phoneNumberId', channel) }
        : {}),
      ...(readOptionalString(input, 'webhookVerifyToken', channel) !== undefined
        ? { webhookVerifyToken: readOptionalString(input, 'webhookVerifyToken', channel) }
        : {}),
      ...retryFields,
    });
  }

  return normalizeAdapterConfig(channel, {
    ...input,
    ...retryFields,
  });
}

function validateAdapterConfigs(
  configs: Partial<Record<GatewayChannelType, GatewayChannelAdapterConfig>>
): Partial<Record<GatewayChannelType, GatewayChannelAdapterConfig>> {
  const validated: Partial<Record<GatewayChannelType, GatewayChannelAdapterConfig>> = {};
  for (const [channel, config] of Object.entries(configs)) {
    const typedChannel = channel as GatewayChannelType;
    if (
      typedChannel !== 'tui'
      && typedChannel !== 'webui'
      && typedChannel !== 'email'
      && typedChannel !== 'telegram'
      && typedChannel !== 'whatsapp'
      && typedChannel !== 'discord'
    ) {
      throw GatewayError.invalidParams(`adapterConfigs.${channel} is not a supported channel`);
    }

    validated[typedChannel] = validateAdapterConfigForChannel(typedChannel, config ?? {});
  }

  return validated;
}

function summarizeAdapterHealth(adapters: GatewayChannelAdapterStatus[]): GatewayChannelsStatusResponse['adapterHealth'] {
  return {
    total: adapters.length,
    running: adapters.filter((item) => item.state === 'running').length,
    stopped: adapters.filter((item) => item.state === 'stopped').length,
    error: adapters.filter((item) => item.state === 'error').length,
    available: adapters.filter((item) => item.available).length,
  };
}

function summarizeRecentAdapterFailures(
  adapters: GatewayChannelAdapterStatus[]
): GatewayChannelsStatusResponse['adapterRecentFailures'] {
  const failures: GatewayChannelsStatusResponse['adapterRecentFailures'] = [];

  for (const adapter of adapters) {
    const latestFailure = [...(adapter.retryTrail ?? [])]
      .reverse()
      .find((attempt) => attempt.outcome === 'failure');
    if (!latestFailure || !latestFailure.error) {
      continue;
    }

    failures.push({
      channel: adapter.channel,
      timestamp: latestFailure.timestamp,
      attempt: latestFailure.attempt,
      error: latestFailure.error,
      reason: latestFailure.reason,
      source: latestFailure.source,
    });
  }

  return failures.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
}

function buildRuntimeTuiConfigResponse(runtime: ReturnType<typeof loadRuntimeConfig>): RuntimeTuiConfigResponse {
  return {
    inputBackgroundColor: runtime.tui.inputBackgroundColor,
    sessionFirstEnabled: runtime.tui.sessionFirstEnabled,
    goalSubmitFastPathEnabled: runtime.tui.goalSubmitFastPathEnabled,
  };
}

function persistModelHintToMainAgent(model: string): SetMainAgentModelHintResponse {
  const runtime = loadRuntimeConfig();
  const agentId = runtime.agent.mainAgentId;
  const userAgentConfigPath = path.join(getUserAgentsDir(), agentId, 'agent.json');
  const workspaceAgentConfigPath = path.join(process.cwd(), 'agents', agentId, 'agent.json');
  const sourcePath = fs.existsSync(userAgentConfigPath)
    ? userAgentConfigPath
    : workspaceAgentConfigPath;

  if (!fs.existsSync(sourcePath)) {
    throw GatewayError.invalidParams(`Agent config not found for '${agentId}'`);
  }

  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as Record<string, unknown>;
  const runner = parsed.runner && typeof parsed.runner === 'object'
    ? { ...(parsed.runner as Record<string, unknown>) }
    : {};
  const runnerConfig = runner.config && typeof runner.config === 'object'
    ? { ...(runner.config as Record<string, unknown>) }
    : {};

  runnerConfig.model_hint = model;
  runner.config = runnerConfig;
  parsed.runner = runner;

  const targetDir = path.dirname(userAgentConfigPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(userAgentConfigPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return { success: true, agentId, model, configPath: userAgentConfigPath };
}

function buildRuntimeRolloutStatus(options?: SystemHandlersOptions): RuntimeRolloutStatusResponse {
  const runtime = loadRuntimeConfig();
  const rollout = runtime.scheduler.runtimeRollout;

  const sourceMetrics = options?.getRuntimeRolloutMetrics?.() ?? EMPTY_RUNTIME_ROLLOUT_METRICS;
  const metrics: RuntimeRolloutMetricsSnapshot = {
    ...sourceMetrics,
    failureCodeCounts: { ...sourceMetrics.failureCodeCounts },
    sessionFirst: { ...sourceMetrics.sessionFirst },
  };
  const goalCoverage = options?.getSessionGoalCoverage?.();
  if (goalCoverage) {
    metrics.sessionFirst = {
      ...metrics.sessionFirst,
      goalsTotal: goalCoverage.goalsTotal,
      goalsWithSessionLink: goalCoverage.goalsWithSessionLink,
      goalSessionCoverageRate: goalCoverage.goalSessionCoverageRate,
    };
  }

  return {
    mode: determineRolloutMode(rollout.shadowModeEnabled, rollout.canaryPercent, rollout.lanePercents),
    schedulerFlags: {
      deterministicRuntimeEnabled: runtime.scheduler.deterministicRuntimeEnabled,
      planCompilerEnabled: runtime.scheduler.planCompilerEnabled,
      toolRoutingMode: runtime.scheduler.toolRoutingMode,
    },
    rollout: {
      shadowModeEnabled: rollout.shadowModeEnabled,
      canaryPercent: rollout.canaryPercent,
      rollbackOnFailure: rollout.rollbackOnFailure,
      lanePercents: rollout.lanePercents,
    },
    metrics,
  };
}

export function registerSystemHandlers(
  rpcHandler: RpcHandler,
  getConnectionManager: () => ConnectionManager,
  getScheduler: () => ISchedulerCore | null,
  getChannelRouter: () => ChannelRouter,
  getStoredChannelEvents: () => StoredChannelEvent[],
  getGatewayStats: () => {
    isRunning: boolean;
    daemonConnected: boolean;
    schedulerConnected: boolean;
  },
  getChannelAdapterStatuses: () => GatewayChannelAdapterStatus[],
  updateChannelAdapterConfigs?: (configs: Partial<Record<GatewayChannelType, GatewayChannelAdapterConfig>>) => Promise<void>,
  onChannelsUpdated?: () => Promise<void>,
  getToolRegistry?: () => ToolRegistry | undefined,
  options?: SystemHandlersOptions,
  getRealtimeMetrics?: () => {
    schedulerCommandAckMsP95: number;
    streamChunkLatencyMsP95: number;
    ackSampleSize: number;
    streamSampleSize: number;
  }
): void {
  rpcHandler.register<Record<string, never>, SystemCapabilitiesResponse>(
    'system.capabilities',
    ['read'],
    async () => {
      const scheduler = getScheduler();
      const toolRegistry = getToolRegistry?.();

      return {
        timestamp: Date.now(),
        schedulerConnected: scheduler !== null,
        capabilities: await getSchedulerCapabilities(toolRegistry),
      };
    }
  );

  rpcHandler.register<Record<string, never>, SystemStatusResponse>(
    'system.status',
    ['admin'],
    async () => {
      const systemInfo = getSystemInfo();
      const processInfo = getAllProcessInfo();
      const connectionManager = getConnectionManager();
      const connStats = connectionManager.getStats();
      const gatewayStats = getGatewayStats();
      const realtimeMetrics = getRealtimeMetrics?.() ?? {
        schedulerCommandAckMsP95: 0,
        streamChunkLatencyMsP95: 0,
        ackSampleSize: 0,
        streamSampleSize: 0,
      };
      const scheduler = getScheduler();

      const response: SystemStatusResponse = {
        timestamp: Date.now(),
        system: systemInfo,
        processes: processInfo,
        gateway: {
          isRunning: gatewayStats.isRunning,
          connections: {
            total: connStats.totalSessions + connStats.pendingConnections,
            authenticated: connStats.totalSessions,
            pending: connStats.pendingConnections,
            byIp: connStats.connectionsByIp,
          },
          daemonConnected: gatewayStats.daemonConnected,
          schedulerConnected: gatewayStats.schedulerConnected,
          realtime: realtimeMetrics,
        },
        scheduler: {
          isConnected: scheduler !== null || processInfo.scheduler.status === 'running',
        },
        runtimeRollout: buildRuntimeRolloutStatus(options),
      };

      if (scheduler) {
        const state = scheduler.getState();
        const metrics = scheduler.getMetrics();

        response.scheduler.state = {
          status: state.status,
          activeGoals: state.activeGoals,
          lastTickAt: state.lastTickAt,
          errorCount: state.errorCount,
        };

        response.scheduler.metrics = {
          goalsProcessed: metrics.totalGoalsProcessed,
          workItemsCompleted: metrics.totalWorkItemsCompleted,
          totalTokensUsed: 0,
          averageCompletionTime: metrics.averageWorkItemDurationMs,
        };
      }

      if (response.scheduler.isConnected) {
        const toolRegistry = getToolRegistry?.();
        response.scheduler.capabilities = await getSchedulerCapabilities(toolRegistry);
      }

      return response;
    }
  );

  rpcHandler.register<Record<string, never>, RuntimeRolloutStatusResponse>(
    'system.runtime.rollout.status',
    ['read'],
    async () => buildRuntimeRolloutStatus(options)
  );

  rpcHandler.register<RuntimeRolloutUpdateParams, RuntimeRolloutStatusResponse>(
    'system.runtime.rollout.update',
    ['admin'],
    async (params) => {
      const runtime = loadRuntimeConfig();

      if (params.rollbackToLegacy === true) {
        runtime.scheduler.deterministicRuntimeEnabled = false;
        runtime.scheduler.planCompilerEnabled = false;
        runtime.scheduler.toolRoutingMode = 'legacy';
        runtime.scheduler.runtimeRollout.shadowModeEnabled = false;
        runtime.scheduler.runtimeRollout.canaryPercent = 0;
        runtime.scheduler.runtimeRollout.lanePercents = {
          dryRun: 0,
          compile: 0,
          replay: 0,
        };
      }

      if (params.shadowModeEnabled !== undefined) {
        runtime.scheduler.runtimeRollout.shadowModeEnabled = params.shadowModeEnabled;
      }

      if (params.canaryPercent !== undefined) {
        runtime.scheduler.runtimeRollout.canaryPercent = toCanaryPercent(
          params.canaryPercent,
          runtime.scheduler.runtimeRollout.canaryPercent
        );
      }

      if (params.lanePercents) {
        const nextLanePercents = {
          ...runtime.scheduler.runtimeRollout.lanePercents,
        };

        if (params.lanePercents.dryRun !== undefined) {
          nextLanePercents.dryRun = toCanaryPercent(
            params.lanePercents.dryRun,
            nextLanePercents.dryRun
          );
        }

        if (params.lanePercents.compile !== undefined) {
          nextLanePercents.compile = toCanaryPercent(
            params.lanePercents.compile,
            nextLanePercents.compile
          );
        }

        if (params.lanePercents.replay !== undefined) {
          nextLanePercents.replay = toCanaryPercent(
            params.lanePercents.replay,
            nextLanePercents.replay
          );
        }

        runtime.scheduler.runtimeRollout.lanePercents = nextLanePercents;
      }

      if (params.rollbackOnFailure !== undefined) {
        runtime.scheduler.runtimeRollout.rollbackOnFailure = params.rollbackOnFailure;
      }

      saveRuntimeConfig(runtime);
      if (options?.applyRuntimeRollout) {
        await options.applyRuntimeRollout(toRuntimeRolloutUpdatePayload(runtime));
      }
      return buildRuntimeRolloutStatus(options);
    }
  );

  rpcHandler.register<RuntimeTuiConfigUpdateParams, RuntimeTuiConfigResponse>(
    'system.runtime.tui.update',
    ['admin'],
    async (params) => {
      const runtime = loadRuntimeConfig();

      if (
        params.sessionFirstEnabled === undefined
        && params.goalSubmitFastPathEnabled === undefined
        && params.inputBackgroundColor === undefined
      ) {
        throw GatewayError.invalidParams('At least one tui config field must be provided');
      }

      if (params.sessionFirstEnabled !== undefined) {
        runtime.tui.sessionFirstEnabled = params.sessionFirstEnabled;
      }

      if (params.goalSubmitFastPathEnabled !== undefined) {
        runtime.tui.goalSubmitFastPathEnabled = false;
      }

      runtime.tui.sessionFirstEnabled = true;
      runtime.tui.goalSubmitFastPathEnabled = false;

      if (params.inputBackgroundColor !== undefined) {
        runtime.tui.inputBackgroundColor = params.inputBackgroundColor;
      }

      saveRuntimeConfig(runtime);
      return buildRuntimeTuiConfigResponse(runtime);
    }
  );

  rpcHandler.register<Record<string, never>, GatewayChannelsStatusResponse>(
    'system.channels.status',
    ['read'],
    async () => {
      const channelRouter = getChannelRouter();
      const adapters = getChannelAdapterStatuses().map((status) => ({
        ...status,
        config: sanitizeAdapterConfig(status.channel, status.config),
      }));
      return {
        enabledChannels: channelRouter.getEnabledChannels(),
        mirrorToAllEnabledChannels: channelRouter.getMirrorToAllEnabledChannels(),
        adapters,
        adapterHealth: summarizeAdapterHealth(adapters),
        adapterRecentFailures: summarizeRecentAdapterFailures(adapters),
      };
    }
  );

  rpcHandler.register<GatewayChannelsUpdateParams, GatewayChannelsStatusResponse>(
    'system.channels.update',
    ['admin'],
    async (params) => {
      const channelRouter = getChannelRouter();

      if (Array.isArray(params.enabledChannels)) {
        channelRouter.setEnabledChannels(params.enabledChannels);
      }

      if (typeof params.mirrorToAllEnabledChannels === 'boolean') {
        channelRouter.setMirrorToAllEnabledChannels(params.mirrorToAllEnabledChannels);
      }

      if (Array.isArray(params.sessionChannelOverrides)) {
        for (const override of params.sessionChannelOverrides) {
          if (override && typeof override.sessionId === 'string') {
            channelRouter.setSessionChannel(override.sessionId, override.channel);
          }
        }
      }

      if (Array.isArray(params.clearSessionChannelOverrides)) {
        for (const sessionId of params.clearSessionChannelOverrides) {
          if (typeof sessionId === 'string' && sessionId.length > 0) {
            channelRouter.clearSessionChannel(sessionId);
          }
        }
      }

      if (params.adapterConfigs && updateChannelAdapterConfigs) {
        const validatedConfigs = validateAdapterConfigs(params.adapterConfigs);
        await updateChannelAdapterConfigs(validatedConfigs);
      }

      if (onChannelsUpdated) {
        await onChannelsUpdated();
      }

      const adapters = getChannelAdapterStatuses().map((status) => ({
        ...status,
        config: sanitizeAdapterConfig(status.channel, status.config),
      }));
      return {
        enabledChannels: channelRouter.getEnabledChannels(),
        mirrorToAllEnabledChannels: channelRouter.getMirrorToAllEnabledChannels(),
        adapters,
        adapterHealth: summarizeAdapterHealth(adapters),
        adapterRecentFailures: summarizeRecentAdapterFailures(adapters),
      };
    }
  );

  rpcHandler.register<GatewayChannelEventsParams, GatewayChannelEventsResponse>(
    'system.channels.events',
    ['read'],
    async (params) => {
      const allEvents = getStoredChannelEvents();
      const sinceTimestamp = typeof params.sinceTimestamp === 'number' ? params.sinceTimestamp : 0;
      const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 200;
      const cursor = typeof params.cursor === 'string' && params.cursor.length > 0
        ? Number.parseInt(params.cursor, 10)
        : 0;
      if (!Number.isInteger(cursor) || cursor < 0) {
        throw GatewayError.invalidParams('cursor must be a non-negative integer string');
      }
      const eventNames = Array.isArray(params.eventNames)
        ? params.eventNames.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];

      const filtered = allEvents.filter((event) => {
        if (event.timestamp < sinceTimestamp) {
          return false;
        }
        if (typeof params.eventPrefix === 'string' && params.eventPrefix.length > 0 && !event.event.startsWith(params.eventPrefix)) {
          return false;
        }
        if (eventNames.length > 0 && !eventNames.includes(event.event)) {
          return false;
        }
        if (params.channelType && event.channelType !== params.channelType) {
          return false;
        }
        if (params.channelSessionId && event.channelSessionId !== params.channelSessionId) {
          return false;
        }
        if (params.sessionId && event.sessionId !== params.sessionId) {
          return false;
        }
        if (params.goalId && event.goalId !== params.goalId) {
          return false;
        }
        if (params.workItemId && event.workItemId !== params.workItemId) {
          return false;
        }
        if (params.runId && event.runId !== params.runId) {
          return false;
        }
        return true;
      });

      const sorted = filtered.sort((a, b) => a.timestamp - b.timestamp);
      const start = Math.min(cursor, sorted.length);
      const events = sorted.slice(start, start + limit);
      const nextCursor = start + events.length < sorted.length ? String(start + events.length) : undefined;

      return {
        events,
        ...(nextCursor ? { nextCursor } : {}),
      };
    }
  );

  rpcHandler.register<SetMainAgentModelHintParams, SetMainAgentModelHintResponse>(
    'system.agent.model_hint.set',
    ['admin'],
    async (params) => {
      if (!params.model || typeof params.model !== 'string' || params.model.trim().length === 0) {
        throw GatewayError.invalidParams('model must be a non-empty string');
      }

      return persistModelHintToMainAgent(params.model.trim());
    }
  );
}
