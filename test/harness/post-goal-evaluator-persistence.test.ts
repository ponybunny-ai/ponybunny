/**
 * PostGoalEvaluator SQLite Persistence Tests
 *
 * Verifies that GoalEvaluationReport persistence to SQLite survives
 * PostGoalEvaluator recreation, and that getReports() filtering/ordering
 * works correctly against persisted data.
 */

import Database from 'better-sqlite3';
import { PostGoalEvaluator } from '../../src/harness/post-goal-evaluator.js';

describe('PostGoalEvaluator SQLite persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    // Create minimal goals table for FK constraint
    db.exec(`CREATE TABLE goals (id TEXT PRIMARY KEY)`);
    db.exec(`INSERT INTO goals (id) VALUES ('goal-1'), ('goal-2'), ('goal-3')`);
  });

  afterEach(() => {
    db.close();
  });

  function createEvaluator(database: Database.Database) {
    const mockScheduler = { on: jest.fn(), off: jest.fn() };
    const mockEvalService = {
      evaluateRun: jest.fn().mockResolvedValue({
        decision: 'publish',
        confidence: 0.9,
        reasoning: 'ok',
        nextActions: [],
      }),
    };
    const mockRepo = {
      getWorkItemsByGoal: jest.fn().mockReturnValue([
        {
          id: 'wi-1',
          created_at: Date.now(),
          updated_at: Date.now(),
          goal_id: 'goal-1',
          title: 'Test Work Item',
          description: 'A test work item',
          item_type: 'code',
          status: 'done',
          priority: 1,
          effort_estimate: 'S',
          retry_count: 0,
          max_retries: 3,
          dependencies: [],
          verification_plan: [],
        },
      ]),
      getRunsByWorkItem: jest.fn().mockReturnValue([
        {
          id: 'run-1',
          created_at: Date.now(),
          work_item_id: 'wi-1',
          goal_id: 'goal-1',
          agent_type: 'code',
          run_sequence: 1,
          status: 'success',
          tokens_used: 100,
          cost_usd: 0.01,
          artifacts: [],
        },
      ]),
      getLatestContextPack: jest.fn().mockReturnValue(undefined),
    };

    return new PostGoalEvaluator({
      schedulerCore: mockScheduler as any,
      evaluationService: mockEvalService as any,
      repository: mockRepo as any,
      db: database,
    });
  }

  test('persisted reports survive PostGoalEvaluator recreation', async () => {
    const evaluator1 = createEvaluator(db);
    await evaluator1.evaluateGoal('goal-1', 'goal_completed');
    await evaluator1.evaluateGoal('goal-2', 'goal_failed');
    evaluator1.stop();

    // Create new evaluator with same DB — simulates daemon restart
    const evaluator2 = createEvaluator(db);
    const reports = evaluator2.getReports();
    expect(reports).toHaveLength(2);
    expect(reports.map(r => r.goalId).sort()).toEqual(['goal-1', 'goal-2']);
  });

  test('getReports with goalId filter on persisted data', async () => {
    const evaluator = createEvaluator(db);
    await evaluator.evaluateGoal('goal-1', 'goal_completed');
    await evaluator.evaluateGoal('goal-2', 'goal_completed');
    await evaluator.evaluateGoal('goal-1', 'goal_failed');

    // New evaluator, same DB
    const evaluator2 = createEvaluator(db);
    const reports = evaluator2.getReports({ goalId: 'goal-1' });
    expect(reports).toHaveLength(2);
    expect(reports.every(r => r.goalId === 'goal-1')).toBe(true);
  });

  test('getReports with limit on persisted data', async () => {
    const evaluator = createEvaluator(db);
    await evaluator.evaluateGoal('goal-1', 'goal_completed');
    await evaluator.evaluateGoal('goal-2', 'goal_completed');
    await evaluator.evaluateGoal('goal-3', 'goal_completed');

    const evaluator2 = createEvaluator(db);
    const reports = evaluator2.getReports({ limit: 2 });
    expect(reports).toHaveLength(2);
  });

  test('persisted reports ordered by created_at DESC', async () => {
    const evaluator = createEvaluator(db);
    // Evaluate in order — goal-1 first, goal-3 last
    // Add small delay between calls to ensure distinct timestamps
    await evaluator.evaluateGoal('goal-1', 'goal_completed');
    await new Promise(r => setTimeout(r, 5));
    await evaluator.evaluateGoal('goal-2', 'goal_completed');
    await new Promise(r => setTimeout(r, 5));
    await evaluator.evaluateGoal('goal-3', 'goal_completed');

    const evaluator2 = createEvaluator(db);
    const reports = evaluator2.getReports();
    // DESC order: newest first (goal-3 has highest timestamp)
    expect(reports[0].goalId).toBe('goal-3');
    expect(reports[2].goalId).toBe('goal-1');
  });
});
