import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentRegistry } from '../src/infra/agents/agent-registry.js';
import { WorkOrderDatabase } from '../src/infra/persistence/work-order-repository.js';
import { reconcileCronJobsFromRegistry } from '../src/infra/scheduler/cron-job-reconciler.js';
import { AgentScheduler } from '../src/scheduler-daemon/agent-scheduler.js';
import type {
  IScheduler,
  SchedulerEventHandler,
  SchedulerState,
} from '../src/scheduler/types.js';
import type { Goal } from '../src/work-order/types/index.js';

const FIXED_NOW_MS = 1_700_200_000_000;
const TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;
const AGENT_ID = 'react-goal-e2e';

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

function assertOrThrow(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeReactGoalAgent(workspaceDir: string): void {
  const agentDir = path.join(workspaceDir, 'agents', AGENT_ID);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), '# react-goal-e2e\n');
  fs.writeFileSync(
    path.join(agentDir, 'agent.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: AGENT_ID,
        name: 'React Goal E2E Agent',
        enabled: true,
        type: 'react_goal',
        schedule: { everyMs: 60_000 },
        policy: {},
        runner: {
          config: {
            goal_title_template: 'Task 23 E2E Goal',
            goal_description_template: 'Verify scheduled react_goal dispatch path end-to-end.',
            budget: {
              tokens: 1234,
              time_minutes: 12,
              cost_usd: 1.25,
            },
            tool_allowlist: ['Read', 'Grep'],
          },
        },
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-e2e-agent-scheduling-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  const configDir = path.join(tempRoot, 'config');
  const skillsDir = path.join(tempRoot, 'skills');
  const socketPath = path.join(tempRoot, 'gateway.sock');
  const dbPath = path.join(tempRoot, 'e2e-agent-scheduling.db');

  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  const previousConfigDir = process.env.PONYBUNNY_CONFIG_DIR;
  const previousSkillsDir = process.env.PONYBUNNY_SKILLS_DIR;
  process.env.PONYBUNNY_CONFIG_DIR = configDir;
  process.env.PONYBUNNY_SKILLS_DIR = skillsDir;

  let repository: WorkOrderDatabase | null = null;

  try {
    writeReactGoalAgent(workspaceDir);

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
    await reconcileCronJobsFromRegistry({ repository, registry });

    const prepDb = new Database(dbPath);
    prepDb.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(FIXED_NOW_MS - 1_000, AGENT_ID);
    prepDb.close();

    const scheduler = new StubScheduler();
    const agentScheduler = new AgentScheduler(
      { repository, scheduler, registry },
      { claimTtlMs: 60_000, instanceId: 'task-23-e2e' }
    );

    const dispatchDeadline = Date.now() + TIMEOUT_MS;
    let dispatchedTotal = 0;

    while (Date.now() < dispatchDeadline && scheduler.submittedGoals.length < 1) {
      const summary = await agentScheduler.dispatchOnce(FIXED_NOW_MS);
      dispatchedTotal += summary.dispatched;
      if (scheduler.submittedGoals.length >= 1) {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    assertOrThrow(
      scheduler.submittedGoals.length === 1,
      `Timed out waiting for single dispatch within ${TIMEOUT_MS}ms (got ${scheduler.submittedGoals.length})`
    );

    for (let i = 0; i < 3; i += 1) {
      const summary = await agentScheduler.dispatchOnce(FIXED_NOW_MS);
      dispatchedTotal += summary.dispatched;
    }

    assertOrThrow(dispatchedTotal === 1, `Expected exactly one dispatch, got ${dispatchedTotal}`);

    const goals = repository.listGoals();
    assertOrThrow(goals.length === 1, `Expected 1 goal, got ${goals.length}`);
    const goal = goals[0];

    const workItems = repository.getWorkItemsByGoal(goal.id);
    assertOrThrow(workItems.length === 1, `Expected 1 work item, got ${workItems.length}`);

    const verifyDb = new Database(dbPath);
    const runRow = verifyDb
      .prepare(
        'SELECT run_key, goal_id, status, scheduled_for_ms FROM cron_job_runs WHERE agent_id = ? ORDER BY created_at_ms DESC LIMIT 1'
      )
      .get(AGENT_ID) as
      | {
          run_key: string;
          goal_id: string | null;
          status: string;
          scheduled_for_ms: number;
        }
      | undefined;

    const runCount = verifyDb
      .prepare('SELECT COUNT(*) as count FROM cron_job_runs WHERE agent_id = ?')
      .get(AGENT_ID) as { count: number };

    const cronJobRow = verifyDb
      .prepare(
        'SELECT in_flight_run_key, in_flight_goal_id, claimed_by, claim_expires_at_ms FROM cron_jobs WHERE agent_id = ?'
      )
      .get(AGENT_ID) as {
      in_flight_run_key: string | null;
      in_flight_goal_id: string | null;
      claimed_by: string | null;
      claim_expires_at_ms: number | null;
    };

    verifyDb.close();

    assertOrThrow(runCount.count === 1, `Expected 1 cron_job_runs row, got ${runCount.count}`);
    assertOrThrow(Boolean(runRow), 'Missing cron_job_runs row for dispatched agent');
    assertOrThrow(runRow?.goal_id === goal.id, 'cron_job_runs.goal_id is not linked to created goal');
    assertOrThrow(
      runRow?.status === 'submitted' || runRow?.status === 'success',
      `Expected cron_job_runs.status to be submitted/success, got ${runRow?.status}`
    );
    assertOrThrow(
      runRow?.scheduled_for_ms === FIXED_NOW_MS - 1_000 || runRow?.scheduled_for_ms === FIXED_NOW_MS,
      `Unexpected scheduled_for_ms value: ${runRow?.scheduled_for_ms}`
    );

    assertOrThrow(cronJobRow.in_flight_run_key === runRow?.run_key, 'cron_jobs.in_flight_run_key not set to dispatched run');
    assertOrThrow(cronJobRow.in_flight_goal_id === goal.id, 'cron_jobs.in_flight_goal_id not set to created goal');
    assertOrThrow(cronJobRow.claimed_by === null, 'cron_jobs.claimed_by should be cleared after dispatch');
    assertOrThrow(cronJobRow.claim_expires_at_ms === null, 'cron_jobs.claim_expires_at_ms should be cleared after dispatch');

    console.log('PASS: in-process scheduled-agent dispatch reached exactly one run.');
    console.log(`PASS: isolated paths db=${dbPath} socket=${socketPath} config=${configDir}`);
    console.log('PASS: DB assertions satisfied for goal/work_item/cron_job_runs linkage and submitted status.');
  } finally {
    if (repository) {
      repository.close();
    }

    if (previousConfigDir === undefined) {
      delete process.env.PONYBUNNY_CONFIG_DIR;
    } else {
      process.env.PONYBUNNY_CONFIG_DIR = previousConfigDir;
    }

    if (previousSkillsDir === undefined) {
      delete process.env.PONYBUNNY_SKILLS_DIR;
    } else {
      process.env.PONYBUNNY_SKILLS_DIR = previousSkillsDir;
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
