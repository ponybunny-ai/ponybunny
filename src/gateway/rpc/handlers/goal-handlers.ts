/**
 * Goal Handlers - RPC handlers for goal operations
 */

import type { IWorkOrderRepository, CreateGoalParams } from '../../../infra/persistence/repository-interface.js';
import type { Goal, GoalStatus } from '../../../work-order/types/index.js';
import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError, ErrorCodes } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';
import type { ISchedulerCore } from '../../../scheduler/core/index.js';
import type { AuditService } from '../../../infra/audit/audit-service.js';

export interface IRemoteSchedulerClient {
  isSchedulerDaemonConnected(): boolean;
  submitGoal(goalId: string): Promise<void>;
  cancelGoal(goalId: string, reason?: string): Promise<void>;
}

export interface GoalSubmitParams {
  title: string;
  description: string;
  success_criteria: Goal['success_criteria'];
  priority?: number;
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
}

export interface GoalStatusParams {
  goalId: string;
}

export interface GoalCancelParams {
  goalId: string;
  reason?: string;
}

export interface GoalListParams {
  status?: GoalStatus;
  limit?: number;
  offset?: number;
}

export interface GoalSubscribeParams {
  goalId: string;
}

export function registerGoalHandlers(
  rpcHandler: RpcHandler,
  repository: IWorkOrderRepository,
  eventBus: EventBus,
  getScheduler?: () => ISchedulerCore | null,
  auditService?: AuditService,
  remoteSchedulerClient?: IRemoteSchedulerClient
): void {
  // goal.submit - Create a new goal
  rpcHandler.register<GoalSubmitParams, Goal>(
    'goal.submit',
    ['write'],
    async (params, session) => {
      if (!params.title || !params.description || !params.success_criteria) {
        throw GatewayError.invalidParams('title, description, and success_criteria are required');
      }

      const createParams: CreateGoalParams = {
        title: params.title,
        description: params.description,
        success_criteria: params.success_criteria,
        priority: params.priority,
        budget_tokens: params.budget_tokens,
        budget_time_minutes: params.budget_time_minutes,
        budget_cost_usd: params.budget_cost_usd,
      };

      const goal = repository.createGoal(createParams);

      repository.createWorkItem({
        goal_id: goal.id,
        title: goal.title,
        description: goal.description,
        item_type: 'analysis',
        priority: goal.priority,
        dependencies: [],
      });

      // Audit log: goal created
      auditService?.logGoalCreated(goal.id, session.publicKey, 'user', {
        title: goal.title,
        description: goal.description,
        priority: goal.priority,
        budget_tokens: goal.budget_tokens,
        budget_time_minutes: goal.budget_time_minutes,
        budget_cost_usd: goal.budget_cost_usd,
      });

      // Auto-subscribe creator to goal events
      session.subscribeToGoal(goal.id);

      eventBus.emit('goal.created', {
        goalId: goal.id,
        title: goal.title,
        createdBy: session.publicKey,
      });

      // Submit to scheduler if connected
      const scheduler = getScheduler?.();
      if (scheduler) {
        await scheduler.submitGoal(goal);
      } else if (remoteSchedulerClient?.isSchedulerDaemonConnected()) {
        await remoteSchedulerClient.submitGoal(goal.id);
      }

      return goal;
    }
  );

  // goal.status - Get goal status and details
  rpcHandler.register<GoalStatusParams, Goal>(
    'goal.status',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      return goal;
    }
  );

  // goal.cancel - Cancel a goal
  rpcHandler.register<GoalCancelParams, { success: boolean }>(
    'goal.cancel',
    ['write'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      if (goal.status === 'cancelled') {
        throw new GatewayError(ErrorCodes.GOAL_ALREADY_CANCELLED);
      }

      if (goal.status === 'completed') {
        throw new GatewayError(
          ErrorCodes.INVALID_STATE_TRANSITION,
          'Cannot cancel a completed goal'
        );
      }

      const oldStatus = goal.status;
      repository.updateGoalStatus(params.goalId, 'cancelled');

      // Audit log: goal cancelled
      auditService?.logGoalStatusChanged(
        params.goalId,
        session.publicKey,
        'user',
        oldStatus,
        'cancelled'
      );

      // Cancel in scheduler if connected
      const scheduler = getScheduler?.();
      if (scheduler) {
        await scheduler.cancelGoal(params.goalId);
      } else if (remoteSchedulerClient?.isSchedulerDaemonConnected()) {
        await remoteSchedulerClient.cancelGoal(params.goalId, params.reason);
      }

      eventBus.emit('goal.cancelled', {
        goalId: params.goalId,
        reason: params.reason,
        cancelledBy: session.publicKey,
      });

      return { success: true };
    }
  );

  // goal.list - List goals with optional filters
  rpcHandler.register<GoalListParams, { goals: Goal[]; total: number }>(
    'goal.list',
    ['read'],
    async (params) => {
      const goals = repository.listGoals({
        status: params.status,
      });

      // Apply pagination
      const offset = params.offset || 0;
      const limit = params.limit || 50;
      const paginatedGoals = goals.slice(offset, offset + limit);

      return {
        goals: paginatedGoals,
        total: goals.length,
      };
    }
  );

  // goal.subscribe - Subscribe to goal events
  rpcHandler.register<GoalSubscribeParams, { success: boolean }>(
    'goal.subscribe',
    ['read'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      session.subscribeToGoal(params.goalId);

      return { success: true };
    }
  );

  // goal.unsubscribe - Unsubscribe from goal events
  rpcHandler.register<GoalSubscribeParams, { success: boolean }>(
    'goal.unsubscribe',
    ['read'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      session.unsubscribeFromGoal(params.goalId);

      return { success: true };
    }
  );
}
