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
import { randomUUID } from 'node:crypto';
import { getGlobalAgentRegistry } from '../../../infra/agents/agent-registry.js';
import { loadRuntimeConfig } from '../../../infra/config/runtime-config.js';
import { ensureAgentWorkdir } from '../../../infra/agents/agent-workdir.js';
import { buildGatewayMessageRouteContext } from '../../../infra/routing/route-context.js';

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
  context?: Record<string, unknown>;
}

export interface GoalStatusParams {
  goalId: string;
}

export interface GoalCancelParams {
  goalId: string;
  reason?: string;
}

export interface GoalDeleteParams {
  goalId: string;
}

export interface GoalListParams {
  status?: GoalStatus;
  limit?: number;
  offset?: number;
}

export interface GoalSubscribeParams {
  goalId: string;
}

export interface AgentCommandSubmitParams {
  command: string;
  agentId?: string;
  priority?: number;
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

const computeEffectiveTools = (allowlist: string[], denylist: string[], forbiddenPatterns: string[]): string[] => {
  const deny = new Set(denylist);
  const matchers = forbiddenPatterns.flatMap((pattern) => {
    if (pattern.length === 0) {
      return [];
    }
    try {
      return [new RegExp(pattern, 'i')];
    } catch {
      return [];
    }
  });

  return allowlist.filter((tool) => !deny.has(tool) && !matchers.some((matcher) => matcher.test(tool)));
};

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
        context: params.context as Record<string, any> | undefined,
      };

      const goal = repository.createGoal(createParams);

      repository.createWorkItem({
        goal_id: goal.id,
        title: goal.title,
        description: goal.description,
        item_type: 'analysis',
        priority: goal.priority,
        dependencies: [],
        context: goal.context
          ? {
              ...goal.context,
              model: typeof (goal.context as Record<string, unknown>).selected_model === 'string'
                ? (goal.context as Record<string, unknown>).selected_model
                : undefined,
            }
          : undefined,
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

  rpcHandler.register<AgentCommandSubmitParams, Goal>(
    'agent.command.submit',
    ['write'],
    async (params, session) => {
      if (!params.command || params.command.trim().length === 0) {
        throw GatewayError.invalidParams('command is required');
      }

      const runtime = loadRuntimeConfig();
      const agentId = params.agentId?.trim() || runtime.agent.mainAgentId;

      const registry = getGlobalAgentRegistry();
      await registry.loadAgents({ workspaceDir: process.cwd() });
      const definition = registry.getAgent(agentId);
      if (!definition || !definition.config.enabled) {
        throw GatewayError.invalidParams(`agent not found or disabled: ${agentId}`);
      }

      const runKey = randomUUID();
      const now = Date.now();

      const goal = repository.createGoal({
        title: `Agent Command: ${definition.config.name}`,
        description: params.command.trim(),
        success_criteria: [
          {
            description: 'Agent command completes successfully',
            type: 'deterministic',
            verification_method: 'status_check',
            required: true,
          },
        ],
        priority: params.priority ?? 50,
      });

      const effectiveTools = computeEffectiveTools(
        toStringArray(definition.config.policy?.toolAllowlist),
        toStringArray(definition.config.policy?.toolDenylist),
        Array.isArray(definition.config.policy?.forbiddenPatterns)
          ? definition.config.policy.forbiddenPatterns.map((item) => item.pattern)
          : []
      );

      const workdir = ensureAgentWorkdir({
        agentId: definition.id,
        configuredWorkdir: definition.config.workdir,
        configPath: definition.configPath,
      });

      repository.createWorkItem({
        goal_id: goal.id,
        title: `Run ${definition.config.name}`,
        description: params.command.trim(),
        item_type: 'analysis',
        priority: params.priority ?? 50,
        dependencies: [],
        context: {
          kind: 'agent_tick',
          agent_id: definition.id,
          definition_hash: definition.definitionHash,
          run_key: runKey,
          scheduled_for_ms: now,
          agent_workdir: workdir,
          tool_allowlist: effectiveTools,
          approval_required: definition.config.policy?.approval?.required === true,
          approval_actions: toStringArray(definition.config.policy?.approval?.actions),
          tool_policy_context: {
            agentId: definition.id,
            isSubagent: false,
            sandboxed: false,
            isOwner: session.permissions.includes('admin') || session.permissions.includes('write'),
          },
          policy_snapshot: definition.config.policy ?? null,
          routeContext: buildGatewayMessageRouteContext({
            agentId: definition.id,
            runKey,
            channel: 'rpc',
            senderId: session.publicKey,
            senderIsOwner: session.permissions.includes('admin'),
          }),
        },
      } as unknown as Parameters<IWorkOrderRepository['createWorkItem']>[0]);

      session.subscribeToGoal(goal.id);
      eventBus.emit('goal.created', {
        goalId: goal.id,
        title: goal.title,
        createdBy: session.publicKey,
      });

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

  rpcHandler.register<GoalDeleteParams, { success: boolean }>(
    'goal.delete',
    ['write'],
    async (params, session) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      repository.deleteGoal(params.goalId);

      eventBus.emit('goal.deleted', {
        goalId: params.goalId,
        deletedBy: session.publicKey,
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
