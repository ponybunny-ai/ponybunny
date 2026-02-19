import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentRegistry } from '../../src/infra/agents/agent-registry.js';
import { WorkOrderDatabase } from '../../src/infra/persistence/work-order-repository.js';
import { reconcileCronJobsFromRegistry } from '../../src/infra/scheduler/cron-job-reconciler.js';
import { AgentScheduler } from '../../src/scheduler-daemon/agent-scheduler.js';
import type {
  IScheduler,
  SchedulerEventHandler,
  SchedulerState,
} from '../../src/scheduler/types.js';
import type { Goal } from '../../src/work-order/types/index.js';

const createTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agent-scheduling-'));

const createTempDbPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agent-scheduling-db-'));
  return path.join(dir, 'agent-scheduling.db');
};

const writeAgent = (workspaceDir: string, id: string, config: Record<string, unknown>): void => {
  const agentDir = path.join(workspaceDir, 'agents', id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), `# ${id}\n`);
};

class StubScheduler implements IScheduler {
  private handlers: SchedulerEventHandler[] = [];
  submittedGoals: Goal[] = [];

  getState(): SchedulerState {
    return {
      status: 'idle',
      activeGoals: [],
      lanes: {
        main: { laneId: 'main', activeCount: 0, queuedCount: 0, isAvailable: true },
        subagent: { laneId: 'subagent', activeCount: 0, queuedCount: 0, isAvailable: true },
        cron: { laneId: 'cron', activeCount: 0, queuedCount: 0, isAvailable: true },
        session: { laneId: 'session', activeCount: 0, queuedCount: 0, isAvailable: true },
      },
      errorCount: 0,
    };
  }

  async start(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async stop(): Promise<void> {}

  async submitGoal(goal: Goal): Promise<void> {
    this.submittedGoals.push(goal);
  }

  async cancelGoal(): Promise<void> {}

  on(handler: SchedulerEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: SchedulerEventHandler): void {
    this.handlers = this.handlers.filter((existing) => existing !== handler);
  }
}

describe('durable agent scheduling integration', () => {
  it('performs due scan with claim exclusivity across repository instances', async () => {
    const now = 1_700_100_000_000;
    const dbPath = createTempDbPath();

    const repositoryA = new WorkOrderDatabase(dbPath);
    await repositoryA.initialize();
    repositoryA.upsertCronJob({
      agent_id: 'agent-claim',
      enabled: true,
      schedule: { kind: 'interval', every_ms: 60000 },
      definition_hash: 'hash-claim',
    });

    const seedDb = new Database(dbPath);
    seedDb.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(now - 1000, 'agent-claim');
    seedDb.close();

    const repositoryB = new WorkOrderDatabase(dbPath);
    await repositoryB.initialize();

    const claimsA = repositoryA.claimDueCronJobs({
      now_ms: now,
      claim_ttl_ms: 60000,
      claimed_by: 'daemon-a',
    });
    const claimsB = repositoryB.claimDueCronJobs({
      now_ms: now,
      claim_ttl_ms: 60000,
      claimed_by: 'daemon-b',
    });

    expect(claimsA.length + claimsB.length).toBe(1);

    const verifyDb = new Database(dbPath);
    const row = verifyDb
      .prepare('SELECT claimed_by, claim_expires_at_ms FROM cron_jobs WHERE agent_id = ?')
      .get('agent-claim') as { claimed_by: string | null; claim_expires_at_ms: number | null };
    verifyDb.close();

    expect(row.claimed_by === 'daemon-a' || row.claimed_by === 'daemon-b').toBe(true);
    expect(row.claim_expires_at_ms).toBe(now + 60000);

    repositoryA.close();
    repositoryB.close();
  });

  it('keeps cron_job_runs idempotent for repeated dispatch of the same scheduled run', async () => {
    const now = 1_700_100_100_000;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-idempotent', {
      schemaVersion: 1,
      id: 'agent-idempotent',
      name: 'Agent Idempotent',
      enabled: true,
      type: 'test',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
    await reconcileCronJobsFromRegistry({ repository, registry });

    const prepDb = new Database(dbPath);
    prepDb
      .prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?')
      .run(now - 1000, 'agent-idempotent');
    prepDb.close();

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const scheduler = new StubScheduler();
    const agentScheduler = new AgentScheduler(
      { repository, scheduler, registry, logger },
      { claimTtlMs: 60000, instanceId: 'daemon-idempotent' }
    );

    const first = await agentScheduler.dispatchOnce(now);
    expect(first.dispatched).toBe(1);

    const firstRunDb = new Database(dbPath);
    const run = firstRunDb
      .prepare('SELECT scheduled_for_ms FROM cron_job_runs WHERE agent_id = ?')
      .get('agent-idempotent') as { scheduled_for_ms: number };
    firstRunDb
      .prepare(
        'UPDATE cron_jobs SET in_flight_run_key = NULL, in_flight_goal_id = NULL, in_flight_started_at_ms = NULL, claimed_at_ms = NULL, claimed_by = NULL, claim_expires_at_ms = NULL, next_run_at_ms = ? WHERE agent_id = ?'
      )
      .run(run.scheduled_for_ms, 'agent-idempotent');
    firstRunDb.close();

    const second = await agentScheduler.dispatchOnce(now);
    expect(second.dispatched).toBe(0);

    const verifyDb = new Database(dbPath);
    const count = verifyDb
      .prepare('SELECT COUNT(*) as count FROM cron_job_runs WHERE agent_id = ? AND scheduled_for_ms = ?')
      .get('agent-idempotent', run.scheduled_for_ms) as { count: number };
    verifyDb.close();

    expect(count.count).toBe(1);
    expect(repository.listGoals()).toHaveLength(1);
    expect(scheduler.submittedGoals).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[AgentScheduler] Idempotent skip for existing run',
      expect.objectContaining({
        agentId: 'agent-idempotent',
        scheduledForMs: run.scheduled_for_ms,
      })
    );

    repository.close();
  });

  it('coalesces misfires into one dispatch and records the coalesced count', async () => {
    const now = 1_700_100_300_000;
    const intervalMs = 60000;
    const initialNextRunAtMs = now - intervalMs * 3;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-coalesce', {
      schemaVersion: 1,
      id: 'agent-coalesce',
      name: 'Agent Coalesce',
      enabled: true,
      type: 'test',
      schedule: { everyMs: intervalMs },
      policy: {},
      runner: {},
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
    await reconcileCronJobsFromRegistry({ repository, registry });

    const prepDb = new Database(dbPath);
    prepDb
      .prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?')
      .run(initialNextRunAtMs, 'agent-coalesce');
    prepDb.close();

    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const scheduler = new StubScheduler();
    const agentScheduler = new AgentScheduler(
      { repository, scheduler, registry, logger },
      { claimTtlMs: 60000, instanceId: 'daemon-coalesce' }
    );

    const summary = await agentScheduler.dispatchOnce(now);
    expect(summary.dispatched).toBe(1);

    const goals = repository.listGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].description).toContain('coalesced_count=3');

    const workItems = repository.getWorkItemsByGoal(goals[0].id);
    expect(workItems).toHaveLength(1);
    expect((workItems[0].context as Record<string, unknown>).scheduled_for_ms).toBe(now);

    const verifyDb = new Database(dbPath);
    const row = verifyDb
      .prepare('SELECT scheduled_for_ms FROM cron_job_runs WHERE agent_id = ?')
      .get('agent-coalesce') as { scheduled_for_ms: number };
    verifyDb.close();

    expect(row.scheduled_for_ms).toBe(now);
    expect(logger.info).toHaveBeenCalledWith(
      '[AgentScheduler] Dispatching cron job',
      expect.objectContaining({
        agentId: 'agent-coalesce',
        scheduledForMs: now,
        coalesced_count: 3,
      })
    );

    repository.close();
  });

  it('prevents duplicate dispatch under multi-daemon contention on one sqlite DB', async () => {
    const now = 1_700_100_500_000;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-contention', {
      schemaVersion: 1,
      id: 'agent-contention',
      name: 'Agent Contention',
      enabled: true,
      type: 'test',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repositoryA = new WorkOrderDatabase(dbPath);
    await repositoryA.initialize();
    await reconcileCronJobsFromRegistry({ repository: repositoryA, registry });

    const repositoryB = new WorkOrderDatabase(dbPath);
    await repositoryB.initialize();

    const prepDb = new Database(dbPath);
    prepDb
      .prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?')
      .run(now - 1000, 'agent-contention');
    prepDb.close();

    const schedulerA = new StubScheduler();
    const schedulerB = new StubScheduler();
    const daemonA = new AgentScheduler(
      { repository: repositoryA, scheduler: schedulerA, registry },
      { claimTtlMs: 60000, instanceId: 'daemon-a' }
    );
    const daemonB = new AgentScheduler(
      { repository: repositoryB, scheduler: schedulerB, registry },
      { claimTtlMs: 60000, instanceId: 'daemon-b' }
    );

    const [summaryA, summaryB] = await Promise.all([daemonA.dispatchOnce(now), daemonB.dispatchOnce(now)]);

    expect(summaryA.dispatched + summaryB.dispatched).toBe(1);
    expect(summaryA.claimed + summaryB.claimed).toBe(1);
    expect(schedulerA.submittedGoals.length + schedulerB.submittedGoals.length).toBe(1);

    const verifyDb = new Database(dbPath);
    const row = verifyDb
      .prepare(
        'SELECT scheduled_for_ms, COUNT(*) as count FROM cron_job_runs WHERE agent_id = ? GROUP BY scheduled_for_ms'
      )
      .get('agent-contention') as { scheduled_for_ms: number; count: number };
    verifyDb.close();

    expect(row.scheduled_for_ms).toBe(now - 1000);
    expect(row.count).toBe(1);
    expect(repositoryA.listGoals()).toHaveLength(1);
    expect(repositoryA.getWorkItemsByGoal(repositoryA.listGoals()[0].id)).toHaveLength(1);

    repositoryA.close();
    repositoryB.close();
  });
});
