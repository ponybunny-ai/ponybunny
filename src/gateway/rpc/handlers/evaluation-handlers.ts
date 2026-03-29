/**
 * Evaluation Handlers - RPC handlers for GoalEvaluationReport access
 *
 * Exposes PostGoalEvaluator reports via Gateway RPC,
 * bridging to the scheduler daemon via IPC.
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { IPCBridge } from '../../integration/ipc-bridge.js';

export function registerEvaluationHandlers(
  rpcHandler: RpcHandler,
  ipcBridge: IPCBridge,
): void {
  // evaluation.list — list GoalEvaluationReports with optional filters
  rpcHandler.register<
    { goalId?: string; limit?: number },
    { reports: unknown[] }
  >(
    'evaluation.list',
    ['read'],
    async (params) => {
      const result = await ipcBridge.listEvaluationReports({
        goalId: params.goalId,
        limit: params.limit,
      });
      return result;
    },
  );

  // evaluation.get — get the latest GoalEvaluationReport for a specific goal
  rpcHandler.register<
    { goalId: string },
    { report: unknown | null }
  >(
    'evaluation.get',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw new Error('goalId is required');
      }
      const result = await ipcBridge.listEvaluationReports({
        goalId: params.goalId,
        limit: 1,
      });
      const report = result.reports.length > 0 ? result.reports[result.reports.length - 1] : null;
      return { report };
    },
  );
}
