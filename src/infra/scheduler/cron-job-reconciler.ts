import type { AgentRegistry } from '../agents/agent-registry.js';
import type {
  CronJob,
  CronJobScheduleInput,
  IWorkOrderRepository,
} from '../persistence/repository-interface.js';
import type { CompiledAgentSchedule } from '../agents/config/index.js';

export interface CronJobReconcileSummary {
  upserted: number;
  disabled: number;
  skipped: number;
}

interface ReconcileParams {
  repository: IWorkOrderRepository;
  registry: AgentRegistry;
  logger?: Pick<Console, 'warn' | 'info' | 'error'>;
}

function mapCompiledSchedule(schedule: CompiledAgentSchedule): CronJobScheduleInput {
  if (schedule.kind === 'cron') {
    if (!schedule.cron) {
      throw new Error('Missing cron expression for cron schedule');
    }
    return {
      kind: 'cron',
      cron: schedule.cron,
      tz: schedule.tz,
    };
  }

  if (schedule.everyMs === undefined) {
    throw new Error('Missing interval for interval schedule');
  }

  return {
    kind: 'interval',
    every_ms: schedule.everyMs,
    tz: schedule.tz,
  };
}

function mapCronJobSchedule(job: CronJob): CronJobScheduleInput | null {
  if (job.schedule_cron) {
    return {
      kind: 'cron',
      cron: job.schedule_cron,
      tz: job.schedule_timezone,
    };
  }

  if (job.schedule_interval_ms !== undefined) {
    return {
      kind: 'interval',
      every_ms: job.schedule_interval_ms,
      tz: job.schedule_timezone,
    };
  }

  return null;
}

export async function reconcileCronJobsFromRegistry(
  params: ReconcileParams
): Promise<CronJobReconcileSummary> {
  const { repository, registry, logger = console } = params;
  const summary: CronJobReconcileSummary = { upserted: 0, disabled: 0, skipped: 0 };

  const agents = registry.getAgents();
  const agentIds = new Set<string>();

  for (const agent of agents) {
    agentIds.add(agent.id);

    try {
      const schedule = mapCompiledSchedule(agent.config.schedule);
      repository.upsertCronJob({
        agent_id: agent.id,
        enabled: agent.config.enabled,
        schedule,
        definition_hash: agent.definitionHash,
      });
      summary.upserted += 1;
    } catch (error) {
      logger.warn(
        `[CronJobReconciler] Skipping agent ${agent.id}: ${(error as Error).message}`
      );
      summary.skipped += 1;
    }
  }

  const existingJobs = repository.listCronJobs();
  for (const job of existingJobs) {
    if (agentIds.has(job.agent_id)) {
      continue;
    }

    const schedule = mapCronJobSchedule(job);
    if (!schedule) {
      logger.warn(
        `[CronJobReconciler] Missing schedule for cron job ${job.agent_id}; leaving as-is.`
      );
      summary.skipped += 1;
      continue;
    }

    repository.upsertCronJob({
      agent_id: job.agent_id,
      enabled: false,
      schedule,
      definition_hash: job.definition_hash,
    });
    summary.disabled += 1;
  }

  return summary;
}
