import type { CreateDecisionParams, IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ExecutionToolPolicyFinalizer, ExecutionToolPolicyDecisionParams, ExecutionToolPolicyLogParams } from './execution-tool-policy-finalizer.js';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

export class LocalExecutionToolPolicyFinalizer implements ExecutionToolPolicyFinalizer {
  private readonly logger: ILogger;

  constructor(logger: ILogger = new NoopLogger()) {
    this.logger = logger.child({ component: 'LocalExecutionToolPolicyFinalizer' });
  }

  buildExecutionLog(params: ExecutionToolPolicyLogParams): string {
    const logs: string[] = [];

    if (params.policyAudit) {
      logs.push(
        `[POLICY_AUDIT] layered=${params.policyAudit.hasLayeredPolicy} layers=${params.policyAudit.appliedLayers.join(',') || 'none'} baseline=${params.policyAudit.baselineAllowedTools.length} effective=${params.policyAudit.effectiveAllowedTools.length} denied=${params.policyAudit.deniedTools.length}`
      );
    }

    if (params.routeContext) {
      logs.push(
        `[ROUTE_CONTEXT] source=${params.routeContext.source} provider=${params.routeContext.providerId || 'unspecified'} channel=${params.routeContext.channel || 'unspecified'} owner=${params.routeContext.senderIsOwner === true ? 'true' : 'false'} sandboxed=${params.routeContext.sandboxed === true ? 'true' : 'false'}`
      );
    }

    if (params.executionLog && params.executionLog.trim().length > 0) {
      logs.push(params.executionLog);
    }

    return logs.join('\n');
  }

  buildDecision(params: ExecutionToolPolicyDecisionParams): CreateDecisionParams | undefined {
    const { policyAudit, routeContext, run, workItem } = params;
    if (!policyAudit) {
      return undefined;
    }

    return {
      run_id: run.id,
      work_item_id: workItem.id,
      goal_id: workItem.goal_id,
      decision_type: 'tool',
      decision_point: 'tool_policy_resolution',
      options_considered: [
        {
          label: 'baseline_allowlist',
          description: `Baseline allowed tools: ${policyAudit.baselineAllowedTools.join(', ') || 'none'}`,
        },
        {
          label: 'effective_tool_envelope',
          description: `Effective tools after policy resolution: ${policyAudit.effectiveAllowedTools.join(', ') || 'none'}`,
        },
      ],
      selected_option: policyAudit.hasLayeredPolicy ? 'layered_policy_applied' : 'allowlist_only',
      reasoning:
        `Applied layers: ${policyAudit.appliedLayers.join(' -> ') || 'none'}; `
        + `Denied tools: ${policyAudit.deniedTools.map((item) => `${item.tool}(${item.reason})`).join(', ') || 'none'}`,
      metadata: {
        policyAudit,
        routeContext,
      },
    };
  }

  persistDecision(repository: IWorkOrderRepository, params: ExecutionToolPolicyDecisionParams): void {
    const decision = this.buildDecision(params);
    if (!decision) {
      return;
    }

    try {
      repository.createDecision(decision);
    } catch (error) {
      this.logger.warn({}, 'Failed to persist tool policy decision');
    }
  }
}
