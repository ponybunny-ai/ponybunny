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
  const baseConfig = {
    $schema: 'https://ponybunny.dho.ai/schemas/agent.schema.json',
    schemaVersion: 1,
    id,
    name: `Agent ${id}`,
    description: 'Growth and pipeline agent',
    enabled: true,
    type: 'growth',
    subAgents: [],
    schedule: {
      everyMs: 60000,
      catchUp: { mode: 'coalesce' },
    },
    policy: {
      toolAllowlist: ['llm.classify', 'pg.select'],
      forbiddenPatterns: [
        {
          pattern: '.pay',
          description: 'Disallow payment execution',
          severity: 'high',
        },
      ],
      prompts: {
        detect_system: 'Return ONLY valid JSON.',
      },
      limits: {
        lead_summary_max_chars: 1800,
      },
    },
    runner: {
      engine: 'default',
      config: {
        tick_defaults: {
          max_events_per_tick: 150,
          max_tasks_per_tick: 80,
          default_lookback_window: '24h',
        },
        circuit_breaker: {
          failure_threshold: 5,
          backoff_minutes: 20,
        },
      },
    },
  };

  fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify({ ...baseConfig, ...config }, null, 2));
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
      name: 'Agent One',
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
      name: 'Agent Two',
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

  it('dispatches schema-driven agents as agent_tick work items', async () => {
    const now = 1_700_000_200_000;
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-growth', {
      name: 'Growth Agent',
      type: 'growth',
      runner: {
        engine: 'default',
        config: {
          tick_defaults: {
            max_events_per_tick: 120,
            max_tasks_per_tick: 60,
            default_lookback_window: '24h',
          },
          circuit_breaker: {
            failure_threshold: 5,
            backoff_minutes: 20,
          },
        },
      },
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
    await reconcileCronJobsFromRegistry({ repository, registry });

    const db = new Database(dbPath);
    db.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(now - 1000, 'agent-growth');
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
    expect(goals[0].budget_tokens).toBeUndefined();
    expect(goals[0].budget_time_minutes).toBeUndefined();
    expect(goals[0].budget_cost_usd).toBeUndefined();

    const workItems = repository.getWorkItemsByGoal(goals[0].id);
    expect(workItems).toHaveLength(1);
    expect((workItems[0].context as Record<string, unknown>).kind).toBe('agent_tick');
    expect((workItems[0].context as Record<string, unknown>).agent_id).toBe('agent-growth');
    expect((workItems[0].context as Record<string, unknown>).run_key).toEqual(expect.any(String));
    expect((workItems[0].context as Record<string, unknown>).routeContext).toEqual(
      expect.objectContaining({
        source: 'scheduler.cron',
        channel: 'internal',
        agentId: 'agent-growth',
      })
    );

    repository.close();
  });
});
