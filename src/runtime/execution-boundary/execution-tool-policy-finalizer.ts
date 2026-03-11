import type { CreateDecisionParams, IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { RouteContext } from '../../infra/routing/route-context.js';
import type { ToolPolicyAuditSnapshot } from '../../infra/tools/tool-registry.js';
import type { Run, WorkItem } from '../../work-order/types/index.js';

export interface ExecutionToolPolicyLogParams {
  executionLog?: string;
  policyAudit?: ToolPolicyAuditSnapshot;
  routeContext?: RouteContext;
}

export interface ExecutionToolPolicyDecisionParams {
  run: Run;
  workItem: WorkItem;
  policyAudit?: ToolPolicyAuditSnapshot;
  routeContext?: RouteContext;
}

export interface ExecutionToolPolicyFinalizer {
  buildExecutionLog(params: ExecutionToolPolicyLogParams): string;
  buildDecision(params: ExecutionToolPolicyDecisionParams): CreateDecisionParams | undefined;
  persistDecision(
    repository: IWorkOrderRepository,
    params: ExecutionToolPolicyDecisionParams
  ): void;
}
