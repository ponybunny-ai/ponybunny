import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { HarnessMetricsService } from '../../../src/app/observability/harness-metrics-service.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

const NOW = Date.now();

function insertGoal(
  db: Database.Database,
  id: string,
  status = 'active',
  createdAt = NOW,
): void {
  db.prepare(
    `INSERT INTO goals (id, created_at, updated_at, title, description, success_criteria, status, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, createdAt, createdAt, 'Goal ' + id, 'desc', '[]', status, 50);
}

function insertWorkItem(
  db: Database.Database,
  id: string,
  goalId: string,
  itemType: string,
): void {
  db.prepare(
    `INSERT INTO work_items (id, created_at, updated_at, goal_id, title, description, item_type, status, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, NOW, NOW, goalId, 'WI ' + id, 'desc', itemType, 'pending', 50);
}

function insertRun(
  db: Database.Database,
  id: string,
  workItemId: string,
  goalId: string,
  status: string,
  opts: { errorSignature?: string; createdAt?: number } = {},
): void {
  db.prepare(
    `INSERT INTO runs (id, created_at, work_item_id, goal_id, agent_type, run_sequence, status, error_signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.createdAt ?? NOW,
    workItemId,
    goalId,
    'test-agent',
    1,
    status,
    opts.errorSignature ?? null,
  );
}

function insertEvalReport(
  db: Database.Database,
  id: string,
  goalId: string,
  summary: {
    total?: number;
    publish?: number;
    retry?: number;
    replan?: number;
    escalate?: number;
    skipped?: number;
  } = {},
): void {
  db.prepare(
    `INSERT INTO goal_evaluation_reports
       (id, created_at, goal_id, "trigger", work_item_results,
        summary_total, summary_publish, summary_retry, summary_replan, summary_escalate, summary_skipped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    NOW,
    goalId,
    'goal_completed',
    '[]',
    summary.total ?? 0,
    summary.publish ?? 0,
    summary.retry ?? 0,
    summary.replan ?? 0,
    summary.escalate ?? 0,
    summary.skipped ?? 0,
  );
}

function insertKnowledge(
  db: Database.Database,
  id: string,
  knowledgeType: string,
  confidence: number,
  lastReinforcedAt = NOW,
): void {
  db.prepare(
    `INSERT INTO global_knowledge (id, created_at, knowledge_type, content, confidence, last_reinforced_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, NOW, knowledgeType, 'content ' + id, confidence, lastReinforcedAt);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarnessMetricsService', () => {
  let db: Database.Database;
  let svc: HarnessMetricsService;

  beforeEach(() => {
    db = createDb();
    svc = new HarnessMetricsService(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // getErrorSignatureClusters
  // -------------------------------------------------------------------------
  describe('getErrorSignatureClusters', () => {
    it('returns empty array when no runs exist', () => {
      expect(svc.getErrorSignatureClusters()).toEqual([]);
    });

    it('returns clusters ordered by count descending', () => {
      insertGoal(db, 'g1');
      insertGoal(db, 'g2');
      insertWorkItem(db, 'wi1', 'g1', 'code');
      insertWorkItem(db, 'wi2', 'g2', 'code');

      // sig-a appears 3 times across 2 goals
      insertRun(db, 'r1', 'wi1', 'g1', 'failure', { errorSignature: 'sig-a', createdAt: NOW - 3000 });
      insertRun(db, 'r2', 'wi1', 'g1', 'failure', { errorSignature: 'sig-a', createdAt: NOW - 2000 });
      insertRun(db, 'r3', 'wi2', 'g2', 'failure', { errorSignature: 'sig-a', createdAt: NOW - 1000 });

      // sig-b appears 1 time
      insertRun(db, 'r4', 'wi1', 'g1', 'failure', { errorSignature: 'sig-b', createdAt: NOW - 500 });

      const result = svc.getErrorSignatureClusters();

      expect(result).toHaveLength(2);
      expect(result[0].error_signature).toBe('sig-a');
      expect(result[0].count).toBe(3);
      expect(result[0].affected_goals).toBe(2);
      expect(result[0].most_recent).toBe(NOW - 1000);

      expect(result[1].error_signature).toBe('sig-b');
      expect(result[1].count).toBe(1);
      expect(result[1].affected_goals).toBe(1);
    });

    it('respects the limit parameter', () => {
      insertGoal(db, 'g1');
      insertWorkItem(db, 'wi1', 'g1', 'code');

      insertRun(db, 'r1', 'wi1', 'g1', 'failure', { errorSignature: 'sig-a' });
      insertRun(db, 'r2', 'wi1', 'g1', 'failure', { errorSignature: 'sig-b' });
      insertRun(db, 'r3', 'wi1', 'g1', 'failure', { errorSignature: 'sig-c' });

      const result = svc.getErrorSignatureClusters(2);
      expect(result).toHaveLength(2);
    });

    it('ignores runs without error_signature', () => {
      insertGoal(db, 'g1');
      insertWorkItem(db, 'wi1', 'g1', 'code');

      insertRun(db, 'r1', 'wi1', 'g1', 'success'); // no error_signature
      insertRun(db, 'r2', 'wi1', 'g1', 'failure', { errorSignature: 'sig-x' });

      const result = svc.getErrorSignatureClusters();
      expect(result).toHaveLength(1);
      expect(result[0].error_signature).toBe('sig-x');
    });
  });

  // -------------------------------------------------------------------------
  // getWorkItemTypeFailureRates
  // -------------------------------------------------------------------------
  describe('getWorkItemTypeFailureRates', () => {
    it('returns empty array when no runs exist', () => {
      expect(svc.getWorkItemTypeFailureRates()).toEqual([]);
    });

    it('computes failure rates correctly for different item types', () => {
      insertGoal(db, 'g1');
      insertWorkItem(db, 'wi-code', 'g1', 'code');
      insertWorkItem(db, 'wi-test', 'g1', 'test');

      // code: 2 runs, 1 failure => 0.5
      insertRun(db, 'r1', 'wi-code', 'g1', 'success');
      insertRun(db, 'r2', 'wi-code', 'g1', 'failure');

      // test: 3 runs, 2 failures => ~0.667
      insertRun(db, 'r3', 'wi-test', 'g1', 'success');
      insertRun(db, 'r4', 'wi-test', 'g1', 'failure');
      insertRun(db, 'r5', 'wi-test', 'g1', 'failure');

      const result = svc.getWorkItemTypeFailureRates();

      expect(result).toHaveLength(2);

      const code = result.find((r) => r.item_type === 'code')!;
      expect(code.total_runs).toBe(2);
      expect(code.failed_runs).toBe(1);
      expect(code.failure_rate).toBe(0.5);

      const test = result.find((r) => r.item_type === 'test')!;
      expect(test.total_runs).toBe(3);
      expect(test.failed_runs).toBe(2);
      expect(test.failure_rate).toBeCloseTo(2 / 3, 5);
    });

    it('returns 0 failure rate when no failures exist', () => {
      insertGoal(db, 'g1');
      insertWorkItem(db, 'wi1', 'g1', 'code');

      insertRun(db, 'r1', 'wi1', 'g1', 'success');
      insertRun(db, 'r2', 'wi1', 'g1', 'success');

      const result = svc.getWorkItemTypeFailureRates();

      expect(result).toHaveLength(1);
      expect(result[0].failure_rate).toBe(0);
      expect(result[0].failed_runs).toBe(0);
      expect(result[0].total_runs).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // getGoalSuccessTimeline
  // -------------------------------------------------------------------------
  describe('getGoalSuccessTimeline', () => {
    it('returns empty array when no goals exist', () => {
      expect(svc.getGoalSuccessTimeline()).toEqual([]);
    });

    it('groups goals by date with correct completed/failed counts', () => {
      // Insert goals with created_at set to "today" in UTC
      const todayMs = Date.now();

      insertGoal(db, 'g1', 'completed', todayMs);
      insertGoal(db, 'g2', 'completed', todayMs);
      insertGoal(db, 'g3', 'cancelled', todayMs);
      insertGoal(db, 'g4', 'blocked', todayMs);
      insertGoal(db, 'g5', 'active', todayMs); // neither completed nor failed

      const result = svc.getGoalSuccessTimeline(1);

      expect(result).toHaveLength(1);
      expect(result[0].completed).toBe(2);
      expect(result[0].failed).toBe(2); // cancelled + blocked
      // Date should be YYYY-MM-DD format
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  // -------------------------------------------------------------------------
  // getEvaluationDecisionDistribution
  // -------------------------------------------------------------------------
  describe('getEvaluationDecisionDistribution', () => {
    it('returns zeros when no reports exist', () => {
      const result = svc.getEvaluationDecisionDistribution();
      expect(result).toEqual({
        total_reports: 0,
        total_publish: 0,
        total_retry: 0,
        total_replan: 0,
        total_escalate: 0,
        total_skipped: 0,
      });
    });

    it('sums all summary columns correctly', () => {
      insertGoal(db, 'g1');
      insertGoal(db, 'g2');

      insertEvalReport(db, 'rpt1', 'g1', {
        total: 5,
        publish: 2,
        retry: 1,
        replan: 1,
        escalate: 0,
        skipped: 1,
      });

      insertEvalReport(db, 'rpt2', 'g2', {
        total: 3,
        publish: 1,
        retry: 0,
        replan: 0,
        escalate: 2,
        skipped: 0,
      });

      const result = svc.getEvaluationDecisionDistribution();

      expect(result.total_reports).toBe(2);
      expect(result.total_publish).toBe(3);
      expect(result.total_retry).toBe(1);
      expect(result.total_replan).toBe(1);
      expect(result.total_escalate).toBe(2);
      expect(result.total_skipped).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getKnowledgeEffectiveness
  // -------------------------------------------------------------------------
  describe('getKnowledgeEffectiveness', () => {
    it('returns empty stats when no knowledge entries exist', () => {
      const result = svc.getKnowledgeEffectiveness();
      expect(result).toEqual({
        total_entries: 0,
        by_type: {},
        avg_confidence: 0,
        recently_reinforced: 0,
      });
    });

    it('computes correct by_type breakdown, avg confidence, and recently reinforced count', () => {
      const recent = Date.now(); // within 7 days
      const old = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days ago

      insertKnowledge(db, 'k1', 'pitfall', 0.8, recent);
      insertKnowledge(db, 'k2', 'pitfall', 0.6, recent);
      insertKnowledge(db, 'k3', 'pattern', 0.9, old);
      insertKnowledge(db, 'k4', 'approach', 0.5, recent);

      const result = svc.getKnowledgeEffectiveness();

      expect(result.total_entries).toBe(4);

      expect(result.by_type).toEqual({
        pitfall: 2,
        pattern: 1,
        approach: 1,
      });

      // avg confidence: (0.8 + 0.6 + 0.9 + 0.5) / 4 = 0.7
      expect(result.avg_confidence).toBe(0.7);

      // k1, k2, k4 are recent; k3 is old
      expect(result.recently_reinforced).toBe(3);
    });
  });
});
