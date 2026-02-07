/**
 * Permission Handlers - RPC handlers for permission operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { IPermissionRequest } from '../../../domain/permission/types.js';
import type { PermissionRepository } from '../../../infra/persistence/permission-repository.js';
import type { EnhancedToolEnforcer } from '../../../infra/tools/enhanced-enforcer.js';
import type { AuditService } from '../../../infra/audit/audit-service.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface PermissionListParams {
  goalId?: string;
  status?: 'pending' | 'approved' | 'denied' | 'expired';
  limit?: number;
}

export interface PermissionGetParams {
  requestId: string;
}

export interface PermissionApproveParams {
  requestId: string;
  note?: string;
  grantDurationMs?: number; // How long the grant should last
}

export interface PermissionDenyParams {
  requestId: string;
  reason?: string;
}

export interface PermissionRevokeParams {
  toolName: string;
  goalId: string;
}

export interface PermissionRevokeAllParams {
  goalId: string;
}

export interface PermissionCheckParams {
  toolName: string;
  goalId: string;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerPermissionHandlers(
  rpcHandler: RpcHandler,
  permissionRepository: PermissionRepository,
  toolEnforcer: EnhancedToolEnforcer,
  auditService?: AuditService
): void {
  // permission.list - List permission requests
  rpcHandler.register<PermissionListParams, { requests: IPermissionRequest[] }>(
    'permission.list',
    ['read'],
    async (params) => {
      let requests: IPermissionRequest[];

      if (params.status === 'pending') {
        requests = permissionRepository.getPendingRequests(params.goalId);
      } else {
        // Get all requests for goal (if specified)
        requests = permissionRepository.getPendingRequests(params.goalId);
      }

      if (params.limit) {
        requests = requests.slice(0, params.limit);
      }

      return { requests };
    }
  );

  // permission.get - Get a specific permission request
  rpcHandler.register<PermissionGetParams, { request: IPermissionRequest | null }>(
    'permission.get',
    ['read'],
    async (params) => {
      if (!params.requestId) {
        throw GatewayError.invalidParams('requestId is required');
      }

      const request = permissionRepository.getRequest(params.requestId);
      return { request: request ?? null };
    }
  );

  // permission.approve - Approve a permission request
  rpcHandler.register<PermissionApproveParams, { success: boolean }>(
    'permission.approve',
    ['write'],
    async (params, session) => {
      if (!params.requestId) {
        throw GatewayError.invalidParams('requestId is required');
      }

      const request = permissionRepository.getRequest(params.requestId);
      if (!request) {
        throw GatewayError.notFound('permission_request', params.requestId);
      }

      if (request.status !== 'pending') {
        throw GatewayError.invalidParams(`Request is already ${request.status}`);
      }

      // Resolve the request
      permissionRepository.resolveRequest(
        params.requestId,
        'approved',
        session.publicKey,
        params.note
      );

      // Grant permission in the enforcer
      const grantDuration = params.grantDurationMs ?? 30 * 60 * 1000; // 30 minutes default
      toolEnforcer.grantPermission(
        request.tool_name,
        request.goal_id,
        session.publicKey,
        grantDuration
      );

      // Also persist the grant
      permissionRepository.grantPermission({
        tool_name: request.tool_name,
        goal_id: request.goal_id,
        expires_at: Date.now() + grantDuration,
        granted_by: session.publicKey,
      });

      // Audit log
      auditService?.logPermissionGranted(
        params.requestId,
        request.tool_name,
        request.goal_id,
        session.publicKey
      );

      return { success: true };
    }
  );

  // permission.deny - Deny a permission request
  rpcHandler.register<PermissionDenyParams, { success: boolean }>(
    'permission.deny',
    ['write'],
    async (params, session) => {
      if (!params.requestId) {
        throw GatewayError.invalidParams('requestId is required');
      }

      const request = permissionRepository.getRequest(params.requestId);
      if (!request) {
        throw GatewayError.notFound('permission_request', params.requestId);
      }

      if (request.status !== 'pending') {
        throw GatewayError.invalidParams(`Request is already ${request.status}`);
      }

      // Resolve the request
      permissionRepository.resolveRequest(
        params.requestId,
        'denied',
        session.publicKey,
        params.reason
      );

      // Audit log
      auditService?.logPermissionDenied(
        params.requestId,
        request.tool_name,
        request.goal_id,
        session.publicKey,
        params.reason
      );

      return { success: true };
    }
  );

  // permission.revoke - Revoke a specific permission grant
  rpcHandler.register<PermissionRevokeParams, { success: boolean }>(
    'permission.revoke',
    ['write'],
    async (params, session) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      // Revoke from enforcer
      toolEnforcer.revokePermission(params.toolName, params.goalId);

      // Revoke from repository
      permissionRepository.revokeGrant(params.toolName, params.goalId);

      return { success: true };
    }
  );

  // permission.revokeAll - Revoke all permissions for a goal
  rpcHandler.register<PermissionRevokeAllParams, { revoked: number }>(
    'permission.revokeAll',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      // Revoke from enforcer
      const enforcerCount = toolEnforcer.revokeAllForGoal(params.goalId);

      // Revoke from repository
      permissionRepository.revokeAllForGoal(params.goalId);

      return { revoked: enforcerCount };
    }
  );

  // permission.check - Check if a tool has permission for a goal
  rpcHandler.register<PermissionCheckParams, { granted: boolean; expires_at?: number }>(
    'permission.check',
    ['read'],
    async (params) => {
      if (!params.toolName || !params.goalId) {
        throw GatewayError.invalidParams('toolName and goalId are required');
      }

      const grant = permissionRepository.getGrant(params.toolName, params.goalId);

      if (grant) {
        return { granted: true, expires_at: grant.expires_at };
      }

      return { granted: false };
    }
  );

  // permission.stats - Get permission statistics
  rpcHandler.register<Record<string, never>, {
    pending_requests: number;
    approved_requests: number;
    denied_requests: number;
    active_grants: number;
  }>(
    'permission.stats',
    ['read'],
    async () => {
      return permissionRepository.getStatistics();
    }
  );

  // permission.layers - Get tool layer configuration
  rpcHandler.register<Record<string, never>, {
    autonomous: string[];
    approval_required: string[];
    forbidden: string[];
  }>(
    'permission.layers',
    ['read'],
    async () => {
      return toolEnforcer.getLayerSummary();
    }
  );

  // permission.cleanup - Clean up expired requests and grants
  rpcHandler.register<Record<string, never>, { expired_requests: number; expired_grants: number }>(
    'permission.cleanup',
    ['admin'],
    async () => {
      const expiredRequests = permissionRepository.expireOldRequests();
      const expiredGrants = permissionRepository.cleanupExpiredGrants();
      toolEnforcer.cleanupExpiredGrants();

      return {
        expired_requests: expiredRequests,
        expired_grants: expiredGrants,
      };
    }
  );
}
