import { routeContextFromWorkItemContext } from '../../infra/routing/route-context.js';
import type { LayeredToolPolicy, ToolPolicyContext } from '../../infra/tools/layered-tool-policy.js';
import { ToolAllowlist, ToolEnforcer, type ToolRegistry } from '../../infra/tools/tool-registry.js';
import type { WorkItem } from '../../work-order/types/index.js';
import type {
  ExecutionToolPolicyPreparer,
  PreparedExecutionToolPolicy,
} from './execution-tool-policy-preparer.js';

interface LocalExecutionToolPolicyPreparerParams {
  toolRegistry: ToolRegistry;
  toolAllowlist: ToolAllowlist;
}

export class LocalExecutionToolPolicyPreparer implements ExecutionToolPolicyPreparer {
  constructor(private readonly params: LocalExecutionToolPolicyPreparerParams) {}

  prepareForWorkItem(workItem: WorkItem): PreparedExecutionToolPolicy | undefined {
    const allowlistOverride = workItem.context?.tool_allowlist;
    const layeredPolicy = this.extractLayeredToolPolicy(workItem);
    const policyContext = this.extractToolPolicyContext(workItem);

    const hasAllowlistOverride = Array.isArray(allowlistOverride);
    const hasLayeredPolicy = layeredPolicy !== undefined;

    if (!hasAllowlistOverride && !hasLayeredPolicy) {
      return undefined;
    }

    const scopedAllowlist = new ToolAllowlist(
      hasAllowlistOverride ? allowlistOverride : this.params.toolAllowlist.getAllowedTools()
    );

    const toolEnforcer = new ToolEnforcer(this.params.toolRegistry, scopedAllowlist, {
      layeredPolicy,
      policyContext,
    });

    return {
      toolEnforcer,
      policyAudit: toolEnforcer.getPolicyAuditSnapshot(),
    };
  }

  private extractLayeredToolPolicy(workItem: WorkItem): LayeredToolPolicy | undefined {
    const context = workItem.context;
    if (!context || typeof context !== 'object') {
      return undefined;
    }

    const explicitPolicy = context.tool_policy;
    if (this.isLayeredToolPolicy(explicitPolicy)) {
      return explicitPolicy;
    }

    const policySnapshot = context.policy_snapshot;
    if (!policySnapshot || typeof policySnapshot !== 'object') {
      return undefined;
    }

    const toolAllowlist = this.toStringArray((policySnapshot as Record<string, unknown>).toolAllowlist);
    if (toolAllowlist.length === 0) {
      return undefined;
    }

    return {
      global: {
        allow: toolAllowlist,
      },
    };
  }

  private extractToolPolicyContext(workItem: WorkItem): ToolPolicyContext {
    const context = workItem.context;
    const routeContext = routeContextFromWorkItemContext(context);
    const policyContextFromWorkItem =
      context && typeof context === 'object' && typeof context.tool_policy_context === 'object' && context.tool_policy_context !== null
        ? (context.tool_policy_context as Record<string, unknown>)
        : {};

    const providerId = this.getString(policyContextFromWorkItem.providerId)
      ?? this.getString(policyContextFromWorkItem.provider_id)
      ?? routeContext?.providerId
      ?? this.getString(context?.model);
    const agentId = this.getString(policyContextFromWorkItem.agentId)
      ?? this.getString(policyContextFromWorkItem.agent_id)
      ?? routeContext?.agentId
      ?? workItem.assigned_agent;

    const isSubagent = this.getBoolean(policyContextFromWorkItem.isSubagent)
      ?? this.getBoolean(policyContextFromWorkItem.is_subagent)
      ?? routeContext?.isSubagent
      ?? this.getBoolean(context?.is_subagent)
      ?? false;
    const sandboxed = this.getBoolean(policyContextFromWorkItem.sandboxed)
      ?? this.getBoolean(policyContextFromWorkItem.isSandboxed)
      ?? routeContext?.sandboxed
      ?? this.getBoolean(context?.sandboxed)
      ?? false;
    const isOwner = this.getBoolean(policyContextFromWorkItem.isOwner)
      ?? this.getBoolean(policyContextFromWorkItem.is_owner)
      ?? routeContext?.senderIsOwner
      ?? this.getBoolean(context?.sender_is_owner)
      ?? false;

    return {
      providerId,
      agentId,
      isSubagent,
      sandboxed,
      isOwner,
    };
  }

  private isLayeredToolPolicy(value: unknown): value is LayeredToolPolicy {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    const supportedKeys = [
      'profiles',
      'groups',
      'global',
      'byProvider',
      'byAgent',
      'subagent',
      'sandbox',
      'ownerOnlyTools',
    ];

    return supportedKeys.some((key) => key in record);
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private getBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }
}
