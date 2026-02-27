import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

describe('WorkOrderDatabase schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  });

  afterEach(() => {
    db.close();
  });

  it('creates cron_jobs table on initialize', () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cron_jobs'")
      .get();

    expect(row).toBeDefined();
  });

  it('includes goals.allowed_actions column in base schema', () => {
    const row = db
      .prepare("SELECT name FROM pragma_table_info('goals') WHERE name = 'allowed_actions'")
      .get();

    expect(row).toBeDefined();
  });

  it('creates run_events table and required indexes', () => {
    const runEventsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_events'")
      .get();

    const idxRunSequence = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_run_events_run_sequence'")
      .get();
    const idxRunTs = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_run_events_run_ts'")
      .get();
    const idxType = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_run_events_type'")
      .get();

    expect(runEventsTable).toBeDefined();
    expect(idxRunSequence).toBeDefined();
    expect(idxRunTs).toBeDefined();
    expect(idxType).toBeDefined();
  });

  it('enforces unique agent schedule per run', () => {
    const insert = db.prepare(`
      INSERT INTO cron_job_runs (
        run_key, agent_id, scheduled_for_ms, created_at_ms, goal_id, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    insert.run('run-1', 'agent-1', 1000, 1000, 'goal-1', 'pending');

    expect(() => {
      insert.run('run-2', 'agent-1', 1000, 1001, 'goal-2', 'pending');
    }).toThrow(/UNIQUE/);

  });

  it('enforces one cron_jobs row per agent', () => {
    const insert = db.prepare(`
      INSERT INTO cron_jobs (
        agent_id, schedule_cron, definition_hash
      ) VALUES (?, ?, ?)
    `);

    insert.run('agent-1', '0 * * * *', 'hash-1');

    expect(() => {
      insert.run('agent-1', '15 * * * *', 'hash-2');
    }).toThrow(/UNIQUE|PRIMARY KEY/);
  });
});
