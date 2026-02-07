/**
 * Audit Handlers - RPC handlers for audit log operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { IAuditLog, AuditAction, AuditEntityType } from '../../../domain/audit/types.js';
import type { AuditService } from '../../../infra/audit/audit-service.js';
import type { AuditLogRepository } from '../../../infra/persistence/audit-repository.js';
import { GatewayError } from '../../errors.js';

// ============================================================================
// Parameter Types
// ============================================================================

export interface AuditListParams {
  limit?: number;
  offset?: number;
}

export interface AuditByGoalParams {
  goalId: string;
  limit?: number;
}

export interface AuditByEntityParams {
  entityType: AuditEntityType;
  entityId: string;
  limit?: number;
}

export interface AuditByActionParams {
  action?: AuditAction;
  actionPrefix?: string;
  limit?: number;
}

export interface AuditByTimeRangeParams {
  from: number;
  to: number;
  limit?: number;
}

export interface AuditByActorParams {
  actor: string;
  limit?: number;
}

export interface AuditPruneParams {
  olderThanDays: number;
}

export interface AuditStatsResult {
  total: number;
  by_action: Record<string, number>;
  by_entity_type: Record<string, number>;
  by_actor_type: Record<string, number>;
  oldest_timestamp?: number;
  newest_timestamp?: number;
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerAuditHandlers(
  rpcHandler: RpcHandler,
  auditService: AuditService,
  auditRepository: AuditLogRepository
): void {
  // audit.list - Get recent audit logs
  rpcHandler.register<AuditListParams, { logs: IAuditLog[]; total: number }>(
    'audit.list',
    ['read'],
    async (params) => {
      const limit = params.limit ?? 100;
      const logs = auditService.getRecentLogs(limit);
      const total = auditRepository.count();

      return { logs, total };
    }
  );

  // audit.byGoal - Get audit logs for a specific goal
  rpcHandler.register<AuditByGoalParams, { logs: IAuditLog[] }>(
    'audit.byGoal',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const logs = auditService.getLogsForGoal(params.goalId, params.limit ?? 100);
      return { logs };
    }
  );

  // audit.byEntity - Get audit logs for a specific entity
  rpcHandler.register<AuditByEntityParams, { logs: IAuditLog[] }>(
    'audit.byEntity',
    ['read'],
    async (params) => {
      if (!params.entityType || !params.entityId) {
        throw GatewayError.invalidParams('entityType and entityId are required');
      }

      const logs = auditService.getLogsForEntity(
        params.entityType,
        params.entityId,
        params.limit ?? 100
      );
      return { logs };
    }
  );

  // audit.byAction - Get audit logs by action type
  rpcHandler.register<AuditByActionParams, { logs: IAuditLog[] }>(
    'audit.byAction',
    ['read'],
    async (params) => {
      if (!params.action && !params.actionPrefix) {
        throw GatewayError.invalidParams('action or actionPrefix is required');
      }

      let logs: IAuditLog[];
      if (params.action) {
        logs = auditService.getLogsByAction(params.action, params.limit ?? 100);
      } else {
        logs = auditService.getLogsByActionPrefix(params.actionPrefix!, params.limit ?? 100);
      }

      return { logs };
    }
  );

  // audit.byTimeRange - Get audit logs within a time range
  rpcHandler.register<AuditByTimeRangeParams, { logs: IAuditLog[] }>(
    'audit.byTimeRange',
    ['read'],
    async (params) => {
      if (params.from === undefined || params.to === undefined) {
        throw GatewayError.invalidParams('from and to timestamps are required');
      }

      if (params.from > params.to) {
        throw GatewayError.invalidParams('from must be less than or equal to to');
      }

      const logs = auditRepository.getByTimeRange(
        params.from,
        params.to,
        params.limit ?? 100
      );
      return { logs };
    }
  );

  // audit.byActor - Get audit logs by actor
  rpcHandler.register<AuditByActorParams, { logs: IAuditLog[] }>(
    'audit.byActor',
    ['read'],
    async (params) => {
      if (!params.actor) {
        throw GatewayError.invalidParams('actor is required');
      }

      const logs = auditRepository.getByActor(params.actor, params.limit ?? 100);
      return { logs };
    }
  );

  // audit.stats - Get audit log statistics
  rpcHandler.register<Record<string, never>, AuditStatsResult>(
    'audit.stats',
    ['read'],
    async () => {
      return auditRepository.getStatistics();
    }
  );

  // audit.prune - Prune old audit logs (admin only)
  rpcHandler.register<AuditPruneParams, { deleted: number }>(
    'audit.prune',
    ['admin'],
    async (params) => {
      if (!params.olderThanDays || params.olderThanDays < 1) {
        throw GatewayError.invalidParams('olderThanDays must be at least 1');
      }

      const olderThanMs = params.olderThanDays * 24 * 60 * 60 * 1000;
      const deleted = auditRepository.prune(olderThanMs);

      return { deleted };
    }
  );
}
