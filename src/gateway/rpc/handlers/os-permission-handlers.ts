/**
 * OS Permission Handlers - RPC handlers for OS service permissions
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { OSService, IOSServicePermission, IOSPermissionRequest } from '../../../domain/permission/os-service.js';
import type { OSServiceChecker } from '../../../infra/permission/os-service-checker.js';
import type { AuditService } from '../../../infra/audit/audit-service.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface OSPermissionCheckParams {
  service: OSService;
  scope: string;
  goalId: string;
}

export interface OSPermissionRequestParams {
  service: OSService;
  scope: string;
  goalId: string;
  workItemId?: string;
  runId?: string;
  reason: string;
}

export interface OSPermissionResolveParams {
  requestId: string;
  note?: string;
  grantDurationMs?: number;
}

export interface OSPermissionRevokeParams {
  service: OSService;
  scope: string;
  goalId: string;
}

export interface OSPermissionListParams {
  goalId: string;
}

export interface OSServiceAvailableParams {
  service: OSService;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerOSPermissionHandlers(
  rpcHandler: RpcHandler,
  osChecker: OSServiceChecker,
  auditService?: AuditService
): void {
  // os.permission.check - Check if an OS service permission is granted
  rpcHandler.register<OSPermissionCheckParams, { granted: boolean; cached: boolean; expiresAt?: number }>(
    'os.permission.check',
    ['read'],
    async (params) => {
      if (!params.service || !params.scope || !params.goalId) {
        throw GatewayError.invalidParams('service, scope, and goalId are required');
      }

      return osChecker.checkPermission(params.service, params.scope, params.goalId);
    }
  );

  // os.permission.request - Request an OS service permission
  rpcHandler.register<OSPermissionRequestParams, { requestId: string }>(
    'os.permission.request',
    ['write'],
    async (params) => {
      if (!params.service || !params.scope || !params.goalId || !params.reason) {
        throw GatewayError.invalidParams('service, scope, goalId, and reason are required');
      }

      const requestId = await osChecker.requestPermission({
        service: params.service,
        scope: params.scope,
        goalId: params.goalId,
        workItemId: params.workItemId,
        runId: params.runId,
        reason: params.reason,
      });

      return { requestId };
    }
  );

  // os.permission.grant - Grant an OS service permission request
  rpcHandler.register<OSPermissionResolveParams, { success: boolean }>(
    'os.permission.grant',
    ['write'],
    async (params, session) => {
      if (!params.requestId) {
        throw GatewayError.invalidParams('requestId is required');
      }

      try {
        await osChecker.grantPermission(
          params.requestId,
          session.publicKey,
          params.grantDurationMs
        );

        return { success: true };
      } catch (error: any) {
        throw GatewayError.invalidParams(error.message);
      }
    }
  );

  // os.permission.deny - Deny an OS service permission request
  rpcHandler.register<OSPermissionResolveParams, { success: boolean }>(
    'os.permission.deny',
    ['write'],
    async (params, session) => {
      if (!params.requestId) {
        throw GatewayError.invalidParams('requestId is required');
      }

      try {
        await osChecker.denyPermission(
          params.requestId,
          session.publicKey,
          params.note
        );

        return { success: true };
      } catch (error: any) {
        throw GatewayError.invalidParams(error.message);
      }
    }
  );

  // os.permission.revoke - Revoke an OS service permission
  rpcHandler.register<OSPermissionRevokeParams, { success: boolean }>(
    'os.permission.revoke',
    ['write'],
    async (params) => {
      if (!params.service || !params.scope || !params.goalId) {
        throw GatewayError.invalidParams('service, scope, and goalId are required');
      }

      const revoked = await osChecker.revokePermission(
        params.service,
        params.scope,
        params.goalId
      );

      return { success: revoked };
    }
  );

  // os.permission.revokeAll - Revoke all OS permissions for a goal
  rpcHandler.register<{ goalId: string }, { revoked: number }>(
    'os.permission.revokeAll',
    ['write'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const revoked = await osChecker.revokeAllForGoal(params.goalId);
      return { revoked };
    }
  );

  // os.permission.list - List active OS permissions for a goal
  rpcHandler.register<OSPermissionListParams, { permissions: IOSServicePermission[] }>(
    'os.permission.list',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const permissions = await osChecker.listActivePermissions(params.goalId);
      return { permissions };
    }
  );

  // os.permission.pending - List pending OS permission requests
  rpcHandler.register<{ goalId?: string }, { requests: IOSPermissionRequest[] }>(
    'os.permission.pending',
    ['read'],
    async (params) => {
      const requests = await osChecker.listPendingRequests(params.goalId);
      return { requests };
    }
  );

  // os.service.available - Check if an OS service is available
  rpcHandler.register<OSServiceAvailableParams, { available: boolean }>(
    'os.service.available',
    ['read'],
    async (params) => {
      if (!params.service) {
        throw GatewayError.invalidParams('service is required');
      }

      const available = await osChecker.isServiceAvailable(params.service);
      return { available };
    }
  );

  // os.service.list - List all supported OS services with availability
  rpcHandler.register<Record<string, never>, { services: Array<{ service: OSService; available: boolean }> }>(
    'os.service.list',
    ['read'],
    async () => {
      const allServices: OSService[] = [
        'keychain',
        'browser',
        'docker',
        'network',
        'filesystem',
        'clipboard',
        'notifications',
        'process',
        'environment',
      ];

      const services = await Promise.all(
        allServices.map(async (service) => ({
          service,
          available: await osChecker.isServiceAvailable(service),
        }))
      );

      return { services };
    }
  );
}
