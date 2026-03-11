import type { ToolEnforcer } from '../../infra/tools/tool-registry.js';
import type { Goal, Run, WorkItem } from '../../work-order/types/index.js';

export interface ExecutionCycleRequest {
  workItem: WorkItem;
  run: Run;
  signal: AbortSignal;
  model?: string;
  goal?: Goal;
  toolEnforcer?: ToolEnforcer;
}

export interface ExecutionCycleResult {
  success: boolean;
  error?: string;
  tokensUsed: number;
  costUsd: number;
  actualModel?: string;
  endpointId?: string;
  artifactIds?: string[];
  log?: string;
}

export interface ExecutionCycleRunner {
  executeCycle(request: ExecutionCycleRequest): Promise<ExecutionCycleResult>;
}
