/**
 * Stuck Detection Handlers - RPC handlers for stuck state monitoring
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { IStuckDetectionService, IStuckWorkItem, IStuckRun, IStuckDetectionConfig } from '../../../domain/stuck/types.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface StuckCheckParams {
  goalId?: string;
}

export interface StuckCheckWorkItemParams {
  workItemId: string;
}

export interface StuckCheckRunParams {
  runId: string;
}

export interface StuckAcknowledgeParams {
  workItemId: string;
  durationMs?: number;
}

export interface StuckConfigUpdateParams {
  config: Partial<IStuckDetectionConfig>;
}

export interface StuckAnalyzeErrorsParams {
  workItemId: string;
}

export interface StuckDetectCyclesParams {
  goalId: string;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerStuckDetectionHandlers(
  rpcHandler: RpcHandler,
  stuckService: IStuckDetectionService
): void {
  // stuck.checkAll - Check all work items for stuck state
  rpcHandler.register<StuckCheckParams, { stuckItems: IStuckWorkItem[] }>(
    'stuck.checkAll',
    ['read'],
    async (params) => {
      const stuckItems = await stuckService.checkAllWorkItems(params.goalId);
      return { stuckItems };
    }
  );

  // stuck.checkWorkItem - Check a specific work item
  rpcHandler.register<StuckCheckWorkItemParams, { stuck: IStuckWorkItem | null }>(
    'stuck.checkWorkItem',
    ['read'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      const stuck = await stuckService.checkWorkItem(params.workItemId);
      return { stuck };
    }
  );

  // stuck.checkAllRuns - Check all runs for stuck state
  rpcHandler.register<StuckCheckParams, { stuckRuns: IStuckRun[] }>(
    'stuck.checkAllRuns',
    ['read'],
    async (params) => {
      const stuckRuns = await stuckService.checkAllRuns(params.goalId);
      return { stuckRuns };
    }
  );

  // stuck.checkRun - Check a specific run
  rpcHandler.register<StuckCheckRunParams, { stuck: IStuckRun | null }>(
    'stuck.checkRun',
    ['read'],
    async (params) => {
      if (!params.runId) {
        throw GatewayError.invalidParams('runId is required');
      }

      const stuck = await stuckService.checkRun(params.runId);
      return { stuck };
    }
  );

  // stuck.detectCycles - Detect circular dependencies
  rpcHandler.register<StuckDetectCyclesParams, { cycles: string[][] }>(
    'stuck.detectCycles',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const cycles = await stuckService.detectCircularDependencies(params.goalId);
      return { cycles };
    }
  );

  // stuck.analyzeErrors - Analyze error patterns for a work item
  rpcHandler.register<StuckAnalyzeErrorsParams, {
    patterns: Array<{ signature: string; count: number; lastSeen: number }>;
    isRepeating: boolean;
    suggestedFix?: string;
  }>(
    'stuck.analyzeErrors',
    ['read'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      return stuckService.analyzeErrorPatterns(params.workItemId);
    }
  );

  // stuck.acknowledge - Acknowledge a stuck item (suppress alerts temporarily)
  rpcHandler.register<StuckAcknowledgeParams, { success: boolean }>(
    'stuck.acknowledge',
    ['write'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      stuckService.acknowledgeStuck(params.workItemId, params.durationMs);
      return { success: true };
    }
  );

  // stuck.config.get - Get current stuck detection configuration
  rpcHandler.register<Record<string, never>, { config: IStuckDetectionConfig }>(
    'stuck.config.get',
    ['read'],
    async () => {
      return { config: stuckService.getConfig() };
    }
  );

  // stuck.config.update - Update stuck detection configuration
  rpcHandler.register<StuckConfigUpdateParams, { config: IStuckDetectionConfig }>(
    'stuck.config.update',
    ['write'],
    async (params) => {
      if (!params.config) {
        throw GatewayError.invalidParams('config is required');
      }

      stuckService.updateConfig(params.config);
      return { config: stuckService.getConfig() };
    }
  );
}
