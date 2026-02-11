import type { RpcHandler } from '../rpc-handler.js';
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
  getToolRegistry?: () => ToolRegistry | undefined
): void {
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
        response.scheduler.capabilities = getSchedulerCapabilities(toolRegistry);
      }

      return response;
    }
  );
}
