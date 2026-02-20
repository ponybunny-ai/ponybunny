import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentRegistry } from '../../../src/infra/agents/agent-registry.js';
import { reconcileCronJobsFromRegistry } from '../../../src/infra/scheduler/cron-job-reconciler.js';
import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';
import { AgentScheduler } from '../../../src/scheduler-daemon/agent-scheduler.js';
import type {
  IScheduler,
  SchedulerEventHandler,
  SchedulerState,
} from '../../../src/scheduler/types.js';
import type { Goal } from '../../../src/work-order/types/index.js';

const createTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agent-scheduler-'));

const createTempDbPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agent-scheduler-db-'));
  return path.join(dir, 'agent-scheduler.db');
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

describe('AgentScheduler', () => {
  it('creates a goal and work item for a due job', async () => {
    const now = 1_700_000_000_000;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-1', {
      schemaVersion: 1,
      id: 'agent-1',
      name: 'Agent One',
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

    const db = new Database(dbPath);
    db.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(now - 1000, 'agent-1');
    db.close();

    const scheduler = new StubScheduler();
    const agentScheduler = new AgentScheduler(
      { repository, scheduler, registry },
      { claimTtlMs: 60000, instanceId: 'test-instance' }
    );

    const summary = await agentScheduler.dispatchOnce(now);
    expect(summary.claimed).toBe(1);
    expect(summary.dispatched).toBe(1);

    const goals = repository.listGoals();
    expect(goals).toHaveLength(1);
    const workItems = repository.getWorkItemsByGoal(goals[0].id);
    expect(workItems).toHaveLength(1);
    expect((workItems[0].context as Record<string, unknown>).routeContext).toEqual(
      expect.objectContaining({
        source: 'scheduler.cron',
        channel: 'internal',
        agentId: 'agent-1',
        matchedBy: 'cron_schedule',
      })
    );

    const verifyDb = new Database(dbPath);
    const run = verifyDb
      .prepare('SELECT goal_id FROM cron_job_runs WHERE agent_id = ?')
      .get('agent-1') as { goal_id: string | null };
    verifyDb.close();

    expect(run).toBeDefined();
    expect(run.goal_id).toBe(goals[0].id);

    repository.close();
  });

  it('deduplicates dispatch for the same scheduled run', async () => {
    const now = 1_700_000_100_000;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-2', {
      schemaVersion: 1,
      id: 'agent-2',
      name: 'Agent Two',
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

    const db = new Database(dbPath);
    db.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(now - 1000, 'agent-2');
    db.close();

    const scheduler = new StubScheduler();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const agentScheduler = new AgentScheduler(
      { repository, scheduler, registry, logger },
      { claimTtlMs: 60000, instanceId: 'test-instance' }
    );

    await agentScheduler.dispatchOnce(now);

    const firstDb = new Database(dbPath);
    const run = firstDb
      .prepare('SELECT scheduled_for_ms FROM cron_job_runs WHERE agent_id = ?')
      .get('agent-2') as { scheduled_for_ms: number };
    firstDb
      .prepare(
        'UPDATE cron_jobs SET in_flight_run_key = NULL, in_flight_goal_id = NULL, in_flight_started_at_ms = NULL, claimed_at_ms = NULL, claimed_by = NULL, claim_expires_at_ms = NULL, next_run_at_ms = ? WHERE agent_id = ?'
      )
      .run(run.scheduled_for_ms, 'agent-2');
    firstDb.close();

    const summary = await agentScheduler.dispatchOnce(now);
    expect(summary.dispatched).toBe(0);

    const goals = repository.listGoals();
    expect(goals).toHaveLength(1);
    const workItems = repository.getWorkItemsByGoal(goals[0].id);
    expect(workItems).toHaveLength(1);

    const verifyDb = new Database(dbPath);
    const rows = verifyDb
      .prepare('SELECT COUNT(*) as count FROM cron_job_runs WHERE agent_id = ?')
      .get('agent-2') as { count: number };
    verifyDb.close();

    expect(rows.count).toBe(1);
    expect(scheduler.submittedGoals).toHaveLength(1);

    expect(logger.info).toHaveBeenCalledWith(
      '[AgentScheduler] Dispatching cron job',
      expect.objectContaining({
        agentId: 'agent-2',
        coalesced_count: 0,
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[AgentScheduler] Idempotent skip for existing run',
      expect.objectContaining({
        agentId: 'agent-2',
        coalesced_count: 0,
        reason: 'run_already_linked_to_goal',
      })
    );

    repository.close();
  });

  it('dispatches react_goal agents with execution context and mapped goal budget', async () => {
    const now = 1_700_000_200_000;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-react-goal', {
      schemaVersion: 1,
      id: 'agent-react-goal',
      name: 'React Goal Agent',
      enabled: true,
      type: 'react_goal',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {
        config: {
          goal_title_template: 'Daily Validation Goal',
          goal_description_template: 'Run daily validation workflow.',
          budget: {
            tokens: 3210,
            time_minutes: 25,
            cost_usd: 4.5,
          },
          model_hint: 'gpt-5.3-codex',
          tool_allowlist: ['Bash', 'Read', 'Grep'],
        },
      },
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
    await reconcileCronJobsFromRegistry({ repository, registry });

    const db = new Database(dbPath);
    db.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(now - 1000, 'agent-react-goal');
    db.close();

    const scheduler = new StubScheduler();
    const agentScheduler = new AgentScheduler(
      { repository, scheduler, registry },
      { claimTtlMs: 60000, instanceId: 'test-instance' }
    );

    const summary = await agentScheduler.dispatchOnce(now);
    expect(summary.claimed).toBe(1);
    expect(summary.dispatched).toBe(1);

    const goals = repository.listGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].budget_tokens).toBe(3210);
    expect(goals[0].budget_time_minutes).toBe(25);
    expect(goals[0].budget_cost_usd).toBe(4.5);

    const workItems = repository.getWorkItemsByGoal(goals[0].id);
    expect(workItems).toHaveLength(1);
    expect((workItems[0].context as Record<string, unknown>).kind).toBeUndefined();
    expect((workItems[0].context as Record<string, unknown>).tool_allowlist).toEqual([
      'Bash',
      'Read',
      'Grep',
    ]);
    expect((workItems[0].context as Record<string, unknown>).model).toBe('gpt-5.3-codex');
    expect((workItems[0].context as Record<string, unknown>).routeContext).toEqual(
      expect.objectContaining({
        source: 'scheduler.cron',
        providerId: 'gpt-5.3-codex',
        channel: 'internal',
        agentId: 'agent-react-goal',
      })
    );

    repository.close();
  });
});
