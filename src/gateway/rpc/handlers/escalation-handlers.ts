/**
 * Escalation Handlers - RPC handlers for escalation operations
 */

import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { Escalation, EscalationStatus, ResolutionAction } from '../../../work-order/types/index.js';
import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError, ErrorCodes } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';

export interface EscalationListParams {
  goalId?: string;
  status?: EscalationStatus;
  limit?: number;
  offset?: number;
}

export interface EscalationGetParams {
  escalationId: string;
}

export interface EscalationRespondParams {
  escalationId: string;
  action: ResolutionAction;
  data?: Record<string, unknown>;
}

// Extended repository interface for escalation operations
interface EscalationRepository extends IWorkOrderRepository {
  getEscalation?(id: string): Escalation | undefined;
  listEscalations?(filters?: { goalId?: string; status?: EscalationStatus }): Escalation[];
  resolveEscalation?(
    id: string,
    action: ResolutionAction,
    data: Record<string, unknown>,
    resolver: string
  ): void;
}

export function registerEscalationHandlers(
  rpcHandler: RpcHandler,
  repository: EscalationRepository,
  eventBus: EventBus
): void {
  // escalation.list - List escalations with optional filters
  rpcHandler.register<EscalationListParams, { escalations: Escalation[]; total: number }>(
    'escalation.list',
    ['read'],
    async (params) => {
      // Check if repository supports escalation listing
      if (!repository.listEscalations) {
        // Fallback: return empty list if not implemented
        return { escalations: [], total: 0 };
      }

      const escalations = repository.listEscalations({
        goalId: params.goalId,
        status: params.status,
      });

      // Apply pagination
      const offset = params.offset || 0;
      const limit = params.limit || 50;
      const total = escalations.length;
      const paginatedEscalations = escalations.slice(offset, offset + limit);

      return {
        escalations: paginatedEscalations,
        total,
      };
    }
  );

  // escalation.get - Get a specific escalation
  rpcHandler.register<EscalationGetParams, Escalation>(
    'escalation.get',
    ['read'],
    async (params) => {
      if (!params.escalationId) {
        throw GatewayError.invalidParams('escalationId is required');
      }

      if (!repository.getEscalation) {
        throw GatewayError.internalError('Escalation retrieval not implemented');
      }

      const escalation = repository.getEscalation(params.escalationId);
      if (!escalation) {
        throw GatewayError.notFound('escalation', params.escalationId);
      }

      return escalation;
    }
  );

  // escalation.respond - Respond to an escalation
  rpcHandler.register<EscalationRespondParams, { success: boolean }>(
    'escalation.respond',
    ['write'],
    async (params, session) => {
      if (!params.escalationId) {
        throw GatewayError.invalidParams('escalationId is required');
      }

      if (!params.action) {
        throw GatewayError.invalidParams('action is required');
      }

      const validActions: ResolutionAction[] = ['user_input', 'skip', 'retry', 'alternative_approach'];
      if (!validActions.includes(params.action)) {
        throw GatewayError.invalidParams(`action must be one of: ${validActions.join(', ')}`);
      }

      if (!repository.getEscalation || !repository.resolveEscalation) {
        throw GatewayError.internalError('Escalation operations not implemented');
      }

      const escalation = repository.getEscalation(params.escalationId);
      if (!escalation) {
        throw GatewayError.notFound('escalation', params.escalationId);
      }

      if (escalation.status === 'resolved' || escalation.status === 'dismissed') {
        throw new GatewayError(ErrorCodes.ESCALATION_ALREADY_RESOLVED);
      }

      repository.resolveEscalation(
        params.escalationId,
        params.action,
        params.data || {},
        session.publicKey
      );

      eventBus.emit('escalation.resolved', {
        escalationId: params.escalationId,
        goalId: escalation.goal_id,
        workItemId: escalation.work_item_id,
        action: params.action,
        resolvedBy: session.publicKey,
      });

      return { success: true };
    }
  );

  // escalation.pending - Get pending escalations count
  rpcHandler.register<Record<string, never>, { count: number }>(
    'escalation.pending',
    ['read'],
    async () => {
      if (!repository.listEscalations) {
        return { count: 0 };
      }

      const escalations = repository.listEscalations({ status: 'open' });
      return { count: escalations.length };
    }
  );
}
