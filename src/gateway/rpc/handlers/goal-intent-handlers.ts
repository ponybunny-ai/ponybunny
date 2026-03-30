/**
 * Goal Intent Handlers — RPC handler for reading classified GoalIntent.
 *
 * Exposes goal.intent which reads the intent from goal.context.intent.
 */

import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { RpcHandler } from '../rpc-handler.js';
import type { GoalIntent } from '../../../domain/work-order/types/goal-intent.js';
import { GatewayError } from '../../errors.js';

export interface GoalIntentParams {
  goalId: string;
}

export interface GoalIntentResult {
  goalId: string;
  intent: GoalIntent | null;
}

export function registerGoalIntentHandlers(
  rpcHandler: RpcHandler,
  repository: IWorkOrderRepository,
): void {
  rpcHandler.register<GoalIntentParams, GoalIntentResult>(
    'goal.intent',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      const intent = (goal.context?.intent as GoalIntent) ?? null;

      return {
        goalId: params.goalId,
        intent,
      };
    },
  );
}
