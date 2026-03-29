/**
 * Plan Review Handlers - RPC handlers for plan approval workflow (Gap 5.A)
 *
 * When a goal is submitted with review_plan context flag, GoalHarness pauses
 * after planning at 'plan_review' status. These handlers allow clients to
 * inspect the planned work items and approve or reject the plan.
 */

import type { RpcHandler } from '../rpc-handler.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IPCBridge } from '../../integration/ipc-bridge.js';
import type { EventBus } from '../../events/event-bus.js';
import type { AuditService } from '../../../infra/audit/audit-service.js';
import { GatewayError } from '../../errors.js';

export function registerPlanReviewHandlers(
  rpcHandler: RpcHandler,
  repository: IWorkOrderRepository,
  ipcBridge: IPCBridge,
  eventBus: EventBus,
  auditService?: AuditService,
): void {
  // plan.get — Get the planned work items for a goal in plan_review status
  rpcHandler.register<
    { goalId: string },
    { goalId: string; status: string; workItems: unknown[] }
  >(
    'plan.get',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      const workItems = repository.getWorkItemsByGoal(params.goalId);

      return {
        goalId: goal.id,
        status: goal.status,
        workItems,
      };
    },
  );

  // plan.approve — Approve a plan and delegate to SchedulerCore
  rpcHandler.register<
    { goalId: string },
    { success: boolean }
  >(
    'plan.approve',
    ['write'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      if (goal.status !== 'plan_review') {
        throw GatewayError.invalidParams(
          `Goal ${params.goalId} is not in plan_review status (current: ${goal.status})`
        );
      }

      await ipcBridge.approvePlan(params.goalId);

      auditService?.logGoalStatusChanged(
        params.goalId,
        session.publicKey,
        'user',
        'plan_review',
        'active',
      );

      eventBus.emit('plan.approved', {
        goalId: params.goalId,
        approvedBy: session.publicKey,
      });

      return { success: true };
    },
  );

  // plan.reject — Reject a plan and cancel the goal
  rpcHandler.register<
    { goalId: string; reason?: string },
    { success: boolean }
  >(
    'plan.reject',
    ['write'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      if (goal.status !== 'plan_review') {
        throw GatewayError.invalidParams(
          `Goal ${params.goalId} is not in plan_review status (current: ${goal.status})`
        );
      }

      repository.updateGoalStatus(params.goalId, 'cancelled');

      auditService?.logGoalStatusChanged(
        params.goalId,
        session.publicKey,
        'user',
        'plan_review',
        'cancelled',
      );

      eventBus.emit('plan.rejected', {
        goalId: params.goalId,
        reason: params.reason,
        rejectedBy: session.publicKey,
      });

      return { success: true };
    },
  );
}
