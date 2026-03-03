import type { RpcHandler } from '../rpc-handler.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConnectionManager } from '../../connection/connection-manager.js';
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
  getGatewayStats: () => {
    isRunning: boolean;
    daemonConnected: boolean;
    schedulerConnected: boolean;
  },
  getToolRegistry?: () => ToolRegistry | undefined,
  options?: SystemHandlersOptions
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
        runtime.tui.goalSubmitFastPathEnabled = params.goalSubmitFastPathEnabled;
      }

      if (params.inputBackgroundColor !== undefined) {
        runtime.tui.inputBackgroundColor = params.inputBackgroundColor;
      }

      saveRuntimeConfig(runtime);
      return buildRuntimeTuiConfigResponse(runtime);
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
