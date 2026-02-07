/**
 * Goal Tool Allowlist Handlers - RPC handlers for per-goal tool permissions
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { GoalScopedAllowlist, IToolAllowlistChange } from '../../../infra/tools/goal-scoped-allowlist.js';
import type { ResponsibilityLayer } from '../../../domain/permission/types.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface GoalToolCheckParams {
  toolName: string;
  goalId: string;
}

export interface GoalToolModifyParams {
  toolName: string;
  goalId: string;
}

export interface GoalToolSetLayerParams {
  toolName: string;
  goalId: string;
  layer: ResponsibilityLayer;
}

export interface GoalToolBulkParams {
  toolNames: string[];
  goalId: string;
}

export interface GoalToolListParams {
  goalId: string;
}

export interface GoalToolInitParams {
  goalId: string;
  parentGoalId?: string;
}

export interface GoalToolHistoryParams {
  goalId?: string;
  limit?: number;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerGoalToolHandlers(
  rpcHandler: RpcHandler,
  allowlist: GoalScopedAllowlist
): void {
  // goal.tools.init - Initialize tool configuration for a goal
  rpcHandler.register<GoalToolInitParams, { success: boolean }>(
    'goal.tools.init',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      allowlist.initializeGoal(params.goalId, params.parentGoalId);
      return { success: true };
    }
  );

  // goal.tools.check - Check if a tool is allowed for a goal
  rpcHandler.register<GoalToolCheckParams, { allowed: boolean; blocked: boolean }>(
    'goal.tools.check',
    ['read'],
    async (params) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      return {
        allowed: allowlist.isAllowed(params.toolName, params.goalId),
        blocked: allowlist.isBlocked(params.toolName, params.goalId),
      };
    }
  );

  // goal.tools.allow - Add a tool to the allowed list for a goal
  rpcHandler.register<GoalToolModifyParams, { success: boolean }>(
    'goal.tools.allow',
    ['write'],
    async (params, session) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      allowlist.allowTool(params.toolName, params.goalId, session.publicKey);
      return { success: true };
    }
  );

  // goal.tools.disallow - Remove a tool from the allowed list for a goal
  rpcHandler.register<GoalToolModifyParams, { success: boolean }>(
    'goal.tools.disallow',
    ['write'],
    async (params, session) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      allowlist.disallowTool(params.toolName, params.goalId, session.publicKey);
      return { success: true };
    }
  );

  // goal.tools.block - Block a tool for a goal
  rpcHandler.register<GoalToolModifyParams, { success: boolean }>(
    'goal.tools.block',
    ['write'],
    async (params, session) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      allowlist.blockTool(params.toolName, params.goalId, session.publicKey);
      return { success: true };
    }
  );

  // goal.tools.unblock - Unblock a tool for a goal
  rpcHandler.register<GoalToolModifyParams, { success: boolean }>(
    'goal.tools.unblock',
    ['write'],
    async (params, session) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      allowlist.unblockTool(params.toolName, params.goalId, session.publicKey);
      return { success: true };
    }
  );

  // goal.tools.setLayer - Set the responsibility layer for a tool in a goal
  rpcHandler.register<GoalToolSetLayerParams, { success: boolean }>(
    'goal.tools.setLayer',
    ['write'],
    async (params, session) => {
      if (!params.toolName || !params.goalId || !params.layer) {
        throw GatewayError.invalidParams('toolName, goalId, and layer are required');
      }

      const validLayers: ResponsibilityLayer[] = ['autonomous', 'approval_required', 'forbidden'];
      if (!validLayers.includes(params.layer)) {
        throw GatewayError.invalidParams(`Invalid layer. Must be one of: ${validLayers.join(', ')}`);
      }

      allowlist.setToolLayer(params.toolName, params.goalId, params.layer, session.publicKey);
      return { success: true };
    }
  );

  // goal.tools.getLayer - Get the responsibility layer for a tool in a goal
  rpcHandler.register<GoalToolCheckParams, { layer: ResponsibilityLayer | null }>(
    'goal.tools.getLayer',
    ['read'],
    async (params) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      const layer = allowlist.getToolLayer(params.toolName, params.goalId);
      return { layer: layer ?? null };
    }
  );

  // goal.tools.setAll - Set allowed tools for a goal (bulk)
  rpcHandler.register<GoalToolBulkParams, { success: boolean }>(
    'goal.tools.setAll',
    ['write'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      allowlist.setAllowedTools(params.toolNames || [], params.goalId, session.publicKey);
      return { success: true };
    }
  );

  // goal.tools.list - List all allowed tools for a goal
  rpcHandler.register<GoalToolListParams, { allowed: string[]; blocked: string[] }>(
    'goal.tools.list',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      return {
        allowed: allowlist.getAllowedTools(params.goalId),
        blocked: allowlist.getBlockedTools(params.goalId),
      };
    }
  );

  // goal.tools.filter - Filter tools to only those allowed for a goal
  rpcHandler.register<GoalToolBulkParams, { allowed: string[] }>(
    'goal.tools.filter',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      return {
        allowed: allowlist.filterAllowed(params.toolNames || [], params.goalId),
      };
    }
  );

  // goal.tools.history - Get change history for tool allowlist
  rpcHandler.register<GoalToolHistoryParams, { changes: IToolAllowlistChange[] }>(
    'goal.tools.history',
    ['read'],
    async (params) => {
      return {
        changes: allowlist.getChangeHistory(params.goalId, params.limit),
      };
    }
  );

  // goal.tools.remove - Remove tool configuration for a goal
  rpcHandler.register<{ goalId: string }, { success: boolean }>(
    'goal.tools.remove',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const removed = allowlist.removeGoalConfig(params.goalId);
      return { success: removed };
    }
  );

  // goal.tools.defaults.list - List default allowed and blocked tools
  rpcHandler.register<Record<string, never>, { allowed: string[]; blocked: string[] }>(
    'goal.tools.defaults.list',
    ['read'],
    async () => {
      return {
        allowed: allowlist.getDefaultAllowedTools(),
        blocked: allowlist.getDefaultBlockedTools(),
      };
    }
  );

  // goal.tools.defaults.addAllowed - Add a tool to default allowed list
  rpcHandler.register<{ toolName: string }, { success: boolean }>(
    'goal.tools.defaults.addAllowed',
    ['write'],
    async (params) => {
      if (!params.toolName) {
        throw GatewayError.invalidParams('toolName is required');
      }

      allowlist.addDefaultAllowed(params.toolName);
      return { success: true };
    }
  );

  // goal.tools.defaults.addBlocked - Add a tool to default blocked list
  rpcHandler.register<{ toolName: string }, { success: boolean }>(
    'goal.tools.defaults.addBlocked',
    ['write'],
    async (params) => {
      if (!params.toolName) {
        throw GatewayError.invalidParams('toolName is required');
      }

      allowlist.addDefaultBlocked(params.toolName);
      return { success: true };
    }
  );
}
