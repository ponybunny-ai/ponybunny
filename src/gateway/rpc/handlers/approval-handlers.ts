/**
 * Approval Handlers - RPC handlers for permission/approval operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';
import type { Permission } from '../../types.js';

// Approval request stored in memory (could be persisted)
interface ApprovalRequest {
  id: string;
  goalId: string;
  workItemId?: string;
  runId?: string;
  requestType: 'tool_execution' | 'resource_access' | 'budget_increase' | 'external_action';
  description: string;
  details: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface ApprovalListParams {
  goalId?: string;
  status?: 'pending' | 'approved' | 'denied';
  limit?: number;
  offset?: number;
}

export interface ApprovalGetParams {
  approvalId: string;
}

export interface ApprovalGrantParams {
  approvalId: string;
  conditions?: Record<string, unknown>;
}

export interface ApprovalDenyParams {
  approvalId: string;
  reason?: string;
}

export interface ApprovalRequestParams {
  goalId: string;
  workItemId?: string;
  runId?: string;
  requestType: ApprovalRequest['requestType'];
  description: string;
  details?: Record<string, unknown>;
}

// In-memory store for approval requests
// In production, this would be persisted to the database
const approvalRequests = new Map<string, ApprovalRequest>();

export function registerApprovalHandlers(
  rpcHandler: RpcHandler,
  eventBus: EventBus
): void {
  // approval.list - List approval requests
  rpcHandler.register<ApprovalListParams, { approvals: ApprovalRequest[]; total: number }>(
    'approval.list',
    ['read'],
    async (params) => {
      let approvals = Array.from(approvalRequests.values());

      // Filter by goalId
      if (params.goalId) {
        approvals = approvals.filter(a => a.goalId === params.goalId);
      }

      // Filter by status
      if (params.status) {
        approvals = approvals.filter(a => a.status === params.status);
      }

      // Sort by creation time (newest first)
      approvals.sort((a, b) => b.createdAt - a.createdAt);

      // Apply pagination
      const offset = params.offset || 0;
      const limit = params.limit || 50;
      const total = approvals.length;
      const paginatedApprovals = approvals.slice(offset, offset + limit);

      return {
        approvals: paginatedApprovals,
        total,
      };
    }
  );

  // approval.get - Get a specific approval request
  rpcHandler.register<ApprovalGetParams, ApprovalRequest>(
    'approval.get',
    ['read'],
    async (params) => {
      if (!params.approvalId) {
        throw GatewayError.invalidParams('approvalId is required');
      }

      const approval = approvalRequests.get(params.approvalId);
      if (!approval) {
        throw GatewayError.notFound('escalation', params.approvalId); // Using escalation as closest match
      }

      return approval;
    }
  );

  // approval.grant - Approve a request
  rpcHandler.register<ApprovalGrantParams, { success: boolean }>(
    'approval.grant',
    ['admin'],
    async (params, session) => {
      if (!params.approvalId) {
        throw GatewayError.invalidParams('approvalId is required');
      }

      const approval = approvalRequests.get(params.approvalId);
      if (!approval) {
        throw GatewayError.notFound('escalation', params.approvalId);
      }

      if (approval.status !== 'pending') {
        throw GatewayError.invalidParams('Approval request is not pending');
      }

      approval.status = 'approved';
      approval.resolvedAt = Date.now();
      approval.resolvedBy = session.publicKey;

      if (params.conditions) {
        approval.details = { ...approval.details, approvalConditions: params.conditions };
      }

      eventBus.emit('approval.granted', {
        approvalId: params.approvalId,
        goalId: approval.goalId,
        workItemId: approval.workItemId,
        grantedBy: session.publicKey,
        conditions: params.conditions,
      });

      return { success: true };
    }
  );

  // approval.deny - Deny a request
  rpcHandler.register<ApprovalDenyParams, { success: boolean }>(
    'approval.deny',
    ['admin'],
    async (params, session) => {
      if (!params.approvalId) {
        throw GatewayError.invalidParams('approvalId is required');
      }

      const approval = approvalRequests.get(params.approvalId);
      if (!approval) {
        throw GatewayError.notFound('escalation', params.approvalId);
      }

      if (approval.status !== 'pending') {
        throw GatewayError.invalidParams('Approval request is not pending');
      }

      approval.status = 'denied';
      approval.resolvedAt = Date.now();
      approval.resolvedBy = session.publicKey;

      if (params.reason) {
        approval.details = { ...approval.details, denialReason: params.reason };
      }

      eventBus.emit('approval.denied', {
        approvalId: params.approvalId,
        goalId: approval.goalId,
        workItemId: approval.workItemId,
        deniedBy: session.publicKey,
        reason: params.reason,
      });

      return { success: true };
    }
  );

  // approval.pending - Get count of pending approvals
  rpcHandler.register<Record<string, never>, { count: number }>(
    'approval.pending',
    ['read'],
    async () => {
      const pendingCount = Array.from(approvalRequests.values())
        .filter(a => a.status === 'pending')
        .length;

      return { count: pendingCount };
    }
  );

  // Internal: Create approval request (called by daemon, not exposed to clients directly)
  // This is registered with admin permission for internal use
  rpcHandler.register<ApprovalRequestParams, ApprovalRequest>(
    'approval.create',
    ['admin'],
    async (params) => {
      if (!params.goalId || !params.requestType || !params.description) {
        throw GatewayError.invalidParams('goalId, requestType, and description are required');
      }

      const id = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const approval: ApprovalRequest = {
        id,
        goalId: params.goalId,
        workItemId: params.workItemId,
        runId: params.runId,
        requestType: params.requestType,
        description: params.description,
        details: params.details || {},
        status: 'pending',
        createdAt: Date.now(),
      };

      approvalRequests.set(id, approval);

      eventBus.emit('approval.requested', {
        approvalId: id,
        goalId: params.goalId,
        workItemId: params.workItemId,
        requestType: params.requestType,
        description: params.description,
      });

      return approval;
    }
  );
}

// Export for testing and internal use
export function clearApprovalRequests(): void {
  approvalRequests.clear();
}

export function getApprovalRequest(id: string): ApprovalRequest | undefined {
  return approvalRequests.get(id);
}
