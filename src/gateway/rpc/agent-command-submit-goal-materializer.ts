import { randomUUID } from 'node:crypto';

import type { Goal } from '../../work-order/types/index.js';
import {
  getGlobalAgentRegistry,
  type AgentRegistry,
} from '../../infra/agents/agent-registry.js';
import { ensureAgentWorkdir } from '../../infra/agents/agent-workdir.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { buildGatewayMessageRouteContext } from '../../infra/routing/route-context.js';
import { GatewayError } from '../errors.js';

export interface RemoteGoalMaterializationRequest {
  goalSpec: {
    title: string;
    description: string;
    success_criteria: Array<{
      description: string;
      type: 'heuristic' | 'deterministic';
      verification_method: string;
      required?: boolean;
    }>;
    priority?: number;
    budget_tokens?: number;
    budget_time_minutes?: number;
    budget_cost_usd?: number;
    context?: Record<string, unknown>;
  };
  initialWorkItemSpec?: {
    title: string;
    description: string;
    item_type: 'analysis' | 'code' | 'test' | 'doc' | 'refactor';
    priority?: number;
    dependencies?: string[];
    context?: Record<string, unknown>;
  };
  autoSubmitGoal?: boolean;
}

export interface RemoteGoalMaterializationResult {
  goal: Goal;
  initialWorkItemId?: string;
}

export interface IRemoteGoalMaterializationClient {
  isSchedulerDaemonConnected(): boolean;
  materializeGoal(
    params: RemoteGoalMaterializationRequest
  ): Promise<RemoteGoalMaterializationResult>;
}

export interface AgentCommandSubmitSessionContext {
  publicKey: string;
  permissions: string[];
}

export interface AgentCommandSubmitGoalMaterializerParams {
  command: string;
  agentId?: string;
  priority?: number;
  session: AgentCommandSubmitSessionContext;
  remoteSchedulerClient?: IRemoteGoalMaterializationClient;
}

export interface AgentCommandSubmitGoalMaterializerDependencies {
  loadRuntimeConfig?: typeof loadRuntimeConfig;
  ensureAgentWorkdir?: typeof ensureAgentWorkdir;
  createRunKey?: () => string;
  getNow?: () => number;
  getWorkspaceDir?: () => string;
}

type AgentRegistryAccess = Pick<AgentRegistry, 'loadAgents' | 'getAgent'>;

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

export interface IAgentCommandSubmitGoalMaterializer {
  materializeAgentCommandGoal(
    params: AgentCommandSubmitGoalMaterializerParams
  ): Promise<RemoteGoalMaterializationResult>;
}

export class RegistryBackedAgentCommandSubmitGoalMaterializer
  implements IAgentCommandSubmitGoalMaterializer {
  constructor(
    private readonly registry: AgentRegistryAccess,
    private readonly dependencies: AgentCommandSubmitGoalMaterializerDependencies = {},
  ) {}

  async materializeAgentCommandGoal(
    params: AgentCommandSubmitGoalMaterializerParams
  ): Promise<RemoteGoalMaterializationResult> {
    const runtimeConfigLoader = this.dependencies.loadRuntimeConfig ?? loadRuntimeConfig;
    const workdirResolver = this.dependencies.ensureAgentWorkdir ?? ensureAgentWorkdir;
    const createRunKey = this.dependencies.createRunKey ?? randomUUID;
    const getNow = this.dependencies.getNow ?? Date.now;
    const getWorkspaceDir = this.dependencies.getWorkspaceDir ?? (() => process.cwd());

    const runtime = runtimeConfigLoader();
    const agentId = params.agentId?.trim() || runtime.agent.mainAgentId;

    await this.registry.loadAgents({ workspaceDir: getWorkspaceDir() });
    const definition = this.registry.getAgent(agentId);
    if (!definition || !definition.config.enabled) {
      throw GatewayError.invalidParams(`agent not found or disabled: ${agentId}`);
    }

    const runKey = createRunKey();
    const now = getNow();

    if (!params.remoteSchedulerClient?.isSchedulerDaemonConnected()) {
      throw GatewayError.internalError('scheduler daemon is required for agent.command.submit');
    }

    const effectiveTools = computeEffectiveTools(
      toStringArray(definition.config.policy?.toolAllowlist),
      toStringArray(definition.config.policy?.toolDenylist),
      Array.isArray(definition.config.policy?.forbiddenPatterns)
        ? definition.config.policy.forbiddenPatterns.map((item) => item.pattern)
        : []
    );

    const workdir = workdirResolver({
      agentId: definition.id,
      configuredWorkdir: definition.config.workdir,
      configPath: definition.configPath,
    });

    return params.remoteSchedulerClient.materializeGoal({
      goalSpec: {
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
      },
      initialWorkItemSpec: {
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
            isOwner: params.session.permissions.includes('admin') || params.session.permissions.includes('write'),
          },
          policy_snapshot: definition.config.policy ?? null,
          routeContext: buildGatewayMessageRouteContext({
            agentId: definition.id,
            runKey,
            channel: 'rpc',
            senderId: params.session.publicKey,
            senderIsOwner: params.session.permissions.includes('admin'),
          }),
        },
      },
      autoSubmitGoal: true,
    });
  }
}

export function createDefaultAgentCommandSubmitGoalMaterializer(): IAgentCommandSubmitGoalMaterializer {
  return new RegistryBackedAgentCommandSubmitGoalMaterializer(getGlobalAgentRegistry());
}
