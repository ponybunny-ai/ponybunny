import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';
const createTempDbPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-cron-'));
  return path.join(dir, 'cron.db');
};

describe('WorkOrderDatabase cron job persistence', () => {
  let dbPath: string;
  let repository: WorkOrderDatabase;

  beforeEach(async () => {
    dbPath = createTempDbPath();
    repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();
  });

  afterEach(() => {
    repository.close();
  });

  it('claims due jobs exclusively between instances', async () => {
    const now = Date.now();

    repository.upsertCronJob({
      agent_id: 'agent-1',
      enabled: true,
      schedule: { kind: 'interval', every_ms: 60000 },
      definition_hash: 'hash-1',
    });

    const db = new Database(dbPath);
    db.prepare('UPDATE cron_jobs SET next_run_at_ms = ? WHERE agent_id = ?').run(now - 1000, 'agent-1');
    db.close();

    const repositoryB = new WorkOrderDatabase(dbPath);
    await repositoryB.initialize();

    const claimsA = repository.claimDueCronJobs({
      now_ms: now,
      claim_ttl_ms: 60000,
      claimed_by: 'instance-a',
    });

    const claimsB = repositoryB.claimDueCronJobs({
      now_ms: now,
      claim_ttl_ms: 60000,
      claimed_by: 'instance-b',
    });

    repositoryB.close();

    expect(claimsA.length + claimsB.length).toBe(1);
  });

  it('respects backoff windows when claiming', () => {
    const now = Date.now();

    repository.upsertCronJob({
      agent_id: 'agent-2',
      enabled: true,
      schedule: { kind: 'interval', every_ms: 60000 },
      definition_hash: 'hash-2',
    });

    repository.updateCronJobAfterOutcome({
      agent_id: 'agent-2',
      next_run_at_ms: now - 1000,
      backoff_until_ms: now + 60000,
      failure_count: 1,
    });

    const claims = repository.claimDueCronJobs({
      now_ms: now,
      claim_ttl_ms: 60000,
      claimed_by: 'instance-a',
    });

    expect(claims).toHaveLength(0);
  });

  it('deduplicates cron job runs by agent and schedule', () => {
    const now = Date.now();

    const first = repository.getOrCreateCronJobRun({
      agent_id: 'agent-3',
      scheduled_for_ms: now,
      created_at_ms: now,
      status: 'pending',
    });

    const second = repository.getOrCreateCronJobRun({
      agent_id: 'agent-3',
      scheduled_for_ms: now,
      created_at_ms: now + 1,
      status: 'pending',
    });

    const db = new Database(dbPath);
    const row = db
      .prepare('SELECT COUNT(*) as count FROM cron_job_runs WHERE agent_id = ? AND scheduled_for_ms = ?')
      .get('agent-3', now) as { count: number };
    db.close();

    expect(row.count).toBe(1);
    expect(second.run_key).toBe(first.run_key);
  });
});
