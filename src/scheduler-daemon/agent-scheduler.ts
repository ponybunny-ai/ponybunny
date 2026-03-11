import type { AgentRegistry } from '../infra/agents/agent-registry.js';
import type {
  CronJob,
  CronJobRunStatus,
  IWorkOrderRepository,
} from '../infra/persistence/repository-interface.js';
import type { SchedulerEvent, IScheduler } from '../scheduler/types.js';
import { computeScheduleOutcome } from '../infra/scheduler/schedule-computation.js';
import { buildCronRouteContext } from '../infra/routing/route-context.js';
import { ensureAgentWorkdir } from '../infra/agents/agent-workdir.js';

export interface AgentSchedulerConfig {
  claimTtlMs: number;
  claimLimit?: number;
  instanceId: string;
}

export interface AgentSchedulerDependencies {
  repository: IWorkOrderRepository;
  scheduler: IScheduler;
  registry: AgentRegistry;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export interface AgentSchedulerDispatchSummary {
  claimed: number;
  skipped: number;
  dispatched: number;
}

export interface AgentSchedulerInFlight {
  agentId: string;
  runKey: string;
  scheduledForMs: number;
  nextRunAtMs: number | null;
}

export interface AgentSchedulerLoopOptions {
  onDispatchError?: (error: unknown) => void;
  setIntervalFn?: typeof setInterval;
}

const DEFAULT_SUCCESS_CRITERIA = [
  {
    description: 'Scheduled work item completed successfully',
    type: 'deterministic' as const,
    verification_method: 'status_check',
    required: true,
  },
];

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

export function startAgentSchedulerLoop(
  agentScheduler: Pick<AgentScheduler, 'dispatchOnce'>,
  tickIntervalMs: number,
  options: AgentSchedulerLoopOptions = {}
): NodeJS.Timeout {
  let dispatchActive = false;
  const setIntervalFn = options.setIntervalFn ?? setInterval;

  return setIntervalFn(() => {
    if (dispatchActive) {
      return;
    }

    dispatchActive = true;
    agentScheduler
      .dispatchOnce()
      .catch((error) => {
        options.onDispatchError?.(error);
      })
      .finally(() => {
        dispatchActive = false;
      });
  }, tickIntervalMs);
}

export class AgentScheduler {
  private inFlightByGoalId = new Map<string, AgentSchedulerInFlight>();
  private logger: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(
    private deps: AgentSchedulerDependencies,
    private config: AgentSchedulerConfig
  ) {
    this.logger = deps.logger ?? console;
  }

  async dispatchOnce(nowMs: number = Date.now()): Promise<AgentSchedulerDispatchSummary> {
    const claimed = this.deps.repository.claimDueCronJobs({
      now_ms: nowMs,
      claim_ttl_ms: this.config.claimTtlMs,
      claimed_by: this.config.instanceId,
      limit: this.config.claimLimit,
    });

    if (claimed.length === 0) {
      return { claimed: 0, skipped: 0, dispatched: 0 };
    }

    let dispatched = 0;
    let skipped = 0;

    for (const job of claimed) {
      const agent = this.deps.registry.getAgent(job.agent_id);
      if (!agent) {
        this.logger.warn('[AgentScheduler] Missing agent definition', {
          agentId: job.agent_id,
        });
        this.releaseClaim(job, nowMs);
        skipped += 1;
        continue;
      }

      if (!agent.config.enabled) {
        this.logger.info('[AgentScheduler] Skipping disabled agent', {
          agentId: job.agent_id,
        });
        this.releaseClaim(job, nowMs);
        skipped += 1;
        continue;
      }

      if (!agent.config.schedule.enabled) {
        this.logger.info('[AgentScheduler] Skipping schedule-disabled agent', {
          agentId: job.agent_id,
        });
        this.releaseClaim(job, nowMs);
        skipped += 1;
        continue;
      }

      let scheduleOutcome;
      try {
        scheduleOutcome = computeScheduleOutcome({
          schedule: agent.config.schedule,
          nowMs,
          last_run_at_ms: job.last_run_at_ms,
          next_run_at_ms: job.next_run_at_ms,
        });
      } catch (error) {
        this.logger.error('[AgentScheduler] Schedule computation failed', {
          agentId: job.agent_id,
          message: (error as Error).message,
        });
        this.releaseClaim(job, nowMs);
        skipped += 1;
        continue;
      }

      if (!scheduleOutcome.due || scheduleOutcome.scheduled_for_ms === null) {
        this.logger.info('[AgentScheduler] Job not due after computation', {
          agentId: job.agent_id,
          nextRunAtMs: scheduleOutcome.next_run_at_ms,
        });
        this.deps.repository.updateCronJobAfterOutcome({
          agent_id: job.agent_id,
          next_run_at_ms: scheduleOutcome.next_run_at_ms,
          failure_count: job.failure_count,
        });
        skipped += 1;
        continue;
      }

      const run = this.deps.repository.getOrCreateCronJobRun({
        agent_id: job.agent_id,
        scheduled_for_ms: scheduleOutcome.scheduled_for_ms,
        created_at_ms: nowMs,
        status: 'claimed',
      });

      if (run.goal_id) {
        this.logger.info('[AgentScheduler] Idempotent skip for existing run', {
          agentId: job.agent_id,
          runKey: run.run_key,
          goalId: run.goal_id,
          scheduledForMs: scheduleOutcome.scheduled_for_ms,
          coalesced_count: scheduleOutcome.coalesced_count,
          reason: 'run_already_linked_to_goal',
        });
        this.deps.repository.updateCronJobAfterOutcome({
          agent_id: job.agent_id,
          next_run_at_ms: scheduleOutcome.next_run_at_ms,
          failure_count: job.failure_count,
        });
        skipped += 1;
        continue;
      }

      const goal = this.deps.repository.createGoal(
        {
          title: `Cron: ${agent.config.name}`,
          description:
            `Scheduled run for agent ${agent.id} ` +
            `(scheduled_for_ms=${scheduleOutcome.scheduled_for_ms}, ` +
            `coalesced_count=${scheduleOutcome.coalesced_count})`,
          success_criteria: DEFAULT_SUCCESS_CRITERIA,
          priority: 50,
        }
      );

      const agentWorkdir = ensureAgentWorkdir({
        agentId: agent.id,
        configuredWorkdir: agent.config.workdir,
        configPath: agent.configPath,
      });

      const workItem = this.deps.repository.createWorkItem({
        goal_id: goal.id,
        title: `Run ${agent.config.name}`,
        description:
          `Execute scheduled agent ${agent.id} ` +
          `(scheduled_for_ms=${scheduleOutcome.scheduled_for_ms}, ` +
          `run_key=${run.run_key})`,
        item_type: 'analysis',
        priority: 50,
        context: {
          kind: 'agent_tick',
          agent_id: agent.id,
          definition_hash: agent.definitionHash,
          run_key: run.run_key,
          scheduled_for_ms: scheduleOutcome.scheduled_for_ms,
          agent_workdir: agentWorkdir,
          tool_allowlist: computeEffectiveTools(
            toStringArray(agent.config.policy?.toolAllowlist),
            toStringArray(agent.config.policy?.toolDenylist),
            Array.isArray(agent.config.policy?.forbiddenPatterns)
              ? agent.config.policy.forbiddenPatterns.map((item) => item.pattern)
              : []
          ),
          approval_required: agent.config.policy?.approval?.required === true,
          approval_actions: toStringArray(agent.config.policy?.approval?.actions),
          tool_policy_context: {
            agentId: agent.id,
            isSubagent: false,
            sandboxed: false,
            isOwner: true,
          },
          policy_snapshot: agent.config.policy ?? null,
          routeContext: buildCronRouteContext({
            agentId: agent.id,
            runKey: run.run_key,
          }),
        },
      } as unknown as Parameters<IWorkOrderRepository['createWorkItem']>[0]);

      this.deps.repository.updateWorkItemStatus(workItem.id, 'ready');
      this.deps.repository.linkCronJobRunToGoal(run.run_key, goal.id);
      this.deps.repository.markCronJobInFlight({
        agent_id: job.agent_id,
        run_key: run.run_key,
        goal_id: goal.id,
        started_at_ms: nowMs,
        last_run_at_ms: scheduleOutcome.scheduled_for_ms,
      });
      this.deps.repository.updateCronJobRunStatus(run.run_key, 'submitted');

      const inFlight: AgentSchedulerInFlight = {
        agentId: job.agent_id,
        runKey: run.run_key,
        scheduledForMs: scheduleOutcome.scheduled_for_ms,
        nextRunAtMs: scheduleOutcome.next_run_at_ms,
      };
      this.inFlightByGoalId.set(goal.id, inFlight);

      this.logger.info('[AgentScheduler] Dispatching cron job', {
        agentId: job.agent_id,
        runKey: run.run_key,
        goalId: goal.id,
        scheduledForMs: scheduleOutcome.scheduled_for_ms,
        coalesced_count: scheduleOutcome.coalesced_count,
      });

      try {
        await this.deps.scheduler.submitGoal(goal);
        dispatched += 1;
      } catch (error) {
        this.logger.error('[AgentScheduler] Failed to submit goal to scheduler', {
          agentId: job.agent_id,
          runKey: run.run_key,
          goalId: goal.id,
          message: error instanceof Error ? error.message : String(error),
        });
        this.deps.repository.updateCronJobRunStatus(run.run_key, 'failure');
        this.deps.repository.updateCronJobAfterOutcome({
          agent_id: job.agent_id,
          next_run_at_ms: scheduleOutcome.next_run_at_ms,
          failure_count: job.failure_count + 1,
        });
        this.inFlightByGoalId.delete(goal.id);
        skipped += 1;
      }
    }

    return { claimed: claimed.length, skipped, dispatched };
  }

  async handleSchedulerEvent(event: SchedulerEvent): Promise<void> {
    if (!event.goalId) {
      return;
    }

    if (event.type === 'goal_completed') {
      this.handleGoalOutcome(event.goalId, 'success');
      return;
    }

    if (event.type === 'goal_failed') {
      this.handleGoalOutcome(event.goalId, 'failure');
    }
  }

  private handleGoalOutcome(goalId: string, status: CronJobRunStatus): void {
    const inFlight = this.inFlightByGoalId.get(goalId);
    if (!inFlight) {
      return;
    }

    const job = this.deps.repository.getCronJob(inFlight.agentId);
    const failureCount = status === 'failure' ? (job?.failure_count ?? 0) + 1 : 0;
    const nextRunAtMs = inFlight.nextRunAtMs ?? job?.next_run_at_ms ?? null;

    this.deps.repository.updateCronJobRunStatus(inFlight.runKey, status);
    this.deps.repository.updateCronJobAfterOutcome({
      agent_id: inFlight.agentId,
      next_run_at_ms: nextRunAtMs,
      failure_count: failureCount,
    });

    this.inFlightByGoalId.delete(goalId);

    this.logger.info('[AgentScheduler] Cleared in-flight cron run', {
      agentId: inFlight.agentId,
      runKey: inFlight.runKey,
      goalId,
      status,
      nextRunAtMs,
    });
  }

  private releaseClaim(job: CronJob, nowMs: number): void {
    const fallbackNextRunAtMs = nowMs + this.config.claimTtlMs;
    this.deps.repository.updateCronJobAfterOutcome({
      agent_id: job.agent_id,
      next_run_at_ms: job.next_run_at_ms ?? fallbackNextRunAtMs,
      failure_count: job.failure_count,
    });
  }
}
