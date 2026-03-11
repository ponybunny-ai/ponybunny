import type { ToolPolicyAuditSnapshot } from '../../infra/tools/tool-registry.js';
import type { ToolEnforcer } from '../../infra/tools/tool-registry.js';
import type { WorkItem } from '../../work-order/types/index.js';

export interface PreparedExecutionToolPolicy {
  toolEnforcer: ToolEnforcer;
  policyAudit: ToolPolicyAuditSnapshot;
}

export interface ExecutionToolPolicyPreparer {
  prepareForWorkItem(workItem: WorkItem): PreparedExecutionToolPolicy | undefined;
}
