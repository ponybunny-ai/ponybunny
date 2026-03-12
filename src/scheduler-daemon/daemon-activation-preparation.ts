import type { AgentRegistry } from '../infra/agents/agent-registry.js';
import { getGlobalAgentRegistry } from '../infra/agents/agent-registry.js';
import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import {
  reconcileCronJobsFromRegistry,
  type CronJobReconcileSummary,
} from '../infra/scheduler/cron-job-reconciler.js';

export interface DaemonActivationPreparationDependencies {
  repository: IWorkOrderRepository;
  registry?: AgentRegistry;
  configuredMainAgentId?: string;
  workspaceDir?: string;
}

export interface DaemonActivationPreparationResult {
  availableAgentIds: string[];
  mainAgentId: string | null;
  cronJobReconcileSummary: CronJobReconcileSummary;
}

export function resolveDaemonMainAgentId(
  configuredId: string | undefined,
  availableIds: string[]
): string | null {
  if (configuredId && availableIds.includes(configuredId)) {
    return configuredId;
  }

  if (availableIds.includes('lead')) {
    return 'lead';
  }

  return availableIds.length > 0 ? availableIds[0] : null;
}

export async function prepareDaemonActivation(
  deps: DaemonActivationPreparationDependencies
): Promise<DaemonActivationPreparationResult> {
  const registry = deps.registry ?? getGlobalAgentRegistry();
  const workspaceDir = deps.workspaceDir ?? process.cwd();

  await registry.loadAgents({ workspaceDir });

  const availableAgentIds = registry.getAgents().map((agent) => agent.id);
  const mainAgentId = resolveDaemonMainAgentId(deps.configuredMainAgentId, availableAgentIds);
  const cronJobReconcileSummary = await reconcileCronJobsFromRegistry({
    repository: deps.repository,
    registry,
    ...(mainAgentId ? { mainAgentId } : {}),
  });

  return {
    availableAgentIds,
    mainAgentId,
    cronJobReconcileSummary,
  };
}
