import type { WorkItem } from '../../work-order/types/index.js';

export interface PreparedExecutionResources {
  blocked: boolean;
  reason?: string;
}

export interface ExecutionResourcePreparer {
  prepareForWorkItem(workItem: WorkItem): Promise<PreparedExecutionResources>;
}
