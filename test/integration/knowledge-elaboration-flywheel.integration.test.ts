/**
 * Integration test: GlobalKnowledgeService → ElaborationService pitfall injection
 *
 * Proves the core flywheel link: pitfalls recorded in global_knowledge via
 * GlobalKnowledgeService.record() are retrieved and injected as clarifications
 * by ElaborationService.elaborateGoal() when both share the same real SQLite DB.
 *
 * No mocks for knowledge or elaboration — real instances, real DB.
 * Repository is minimally mocked (only the methods ElaborationService calls).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { GlobalKnowledgeService } from '../../src/domain/knowledge/global-knowledge-service.js';
import { ElaborationService } from '../../src/app/lifecycle/elaboration/elaboration-service.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { Goal } from '../../src/work-order/types/index.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

function makeGoal(overrides?: Partial<Goal>): Goal {
  return {
    id: 'goal-int-1',
    title: 'Integration Test Goal',
    description: 'A sufficiently long goal description that exceeds the fifty character minimum threshold for elaboration validation',
    status: 'queued',
    created_at: Date.now(),
    updated_at: Date.now(),
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    success_criteria: [
      { description: 'Tests pass', type: 'deterministic', verification_method: 'npm test', required: true },
    ],
    priority: 50,
    budget_tokens: 100000,
    ...overrides,
  };
}

function makeMockRepo(): Partial<IWorkOrderRepository> {
  return {
    updateGoalStatus: jest.fn(),
    createEscalation: jest.fn(),
    getGoal: jest.fn(),
  };
}

describe('Integration: GlobalKnowledgeService → ElaborationService pitfall injection', () => {
  let db: Database.Database;
  let knowledgeService: GlobalKnowledgeService;
  let elaborationService: ElaborationService;
  let mockRepo: Partial<IWorkOrderRepository>;

  beforeEach(() => {
    db = createDb();
    knowledgeService = new GlobalKnowledgeService(db);
    mockRepo = makeMockRepo();
    elaborationService = new ElaborationService(
      mockRepo as IWorkOrderRepository,
      knowledgeService,
    );
  });

  afterEach(() => {
    db.close();
  });

  test('pitfall recorded via record() appears in elaboration clarifications', async () => {
    // Insert a goal so FK constraint is satisfied
    const now = Date.now();
    db.prepare(`
      INSERT INTO goals (id, created_at, updated_at, title, description, success_criteria, status, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old-goal', now, now, 'Old Goal', 'Previous goal', '[]', 'completed', 50);

    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Always verify services are wired into all execution paths',
      confidence: 0.8,
      source_goal_id: 'old-goal',
    });

    const result = await elaborationService.elaborateGoal(makeGoal());

    expect(result.escalations).toHaveLength(0);
    // Should have at least one clarification containing the pitfall
    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeDefined();
    expect(pitfallClarification).toContain('Always verify services are wired into all execution paths');
    expect(pitfallClarification).toContain('[Known pitfall, confidence 0.8]');
  });

  test('pitfall with confidence below 0.4 threshold is NOT injected', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Low confidence pitfall that should be filtered out',
      confidence: 0.3,
    });

    const result = await elaborationService.elaborateGoal(makeGoal());

    // No pitfall clarifications should appear (confidence below threshold)
    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeUndefined();
  });

  test('at most 5 pitfalls are injected (limit enforcement)', async () => {
    // Record 7 pitfalls above threshold
    for (let i = 0; i < 7; i++) {
      knowledgeService.record({
        knowledge_type: 'pitfall',
        content: `Pitfall number ${i + 1} that should be considered`,
        confidence: 0.5 + i * 0.05,
      });
    }

    const result = await elaborationService.elaborateGoal(makeGoal());

    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeDefined();
    // Should say "5 relevant pitfall(s)" not 7
    expect(pitfallClarification).toContain('5 relevant pitfall(s)');
  });

  test('no pitfalls recorded → no pitfall clarifications', async () => {
    const result = await elaborationService.elaborateGoal(makeGoal());

    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeUndefined();
    expect(result.escalations).toHaveLength(0);
  });

  test('only pitfall-type knowledge is injected, not patterns or approaches', async () => {
    knowledgeService.record({
      knowledge_type: 'pattern',
      content: 'Prefer composition over inheritance',
      confidence: 0.9,
    });
    knowledgeService.record({
      knowledge_type: 'approach',
      content: 'Test-first development works best',
      confidence: 0.9,
    });

    const result = await elaborationService.elaborateGoal(makeGoal());

    // No pitfall-related clarifications since only patterns/approaches were recorded
    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeUndefined();
  });

  test('graceful degradation when knowledge DB is closed', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'This pitfall should not crash',
      confidence: 0.8,
    });

    // Close DB to simulate failure
    db.close();

    // ElaborationService should catch the error and continue without pitfalls
    const result = await elaborationService.elaborateGoal(makeGoal());

    // Should succeed without pitfall clarifications
    expect(result.escalations).toHaveLength(0);
    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeUndefined();
  });

  test('multiple pitfalls are consolidated into a single clarification entry', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'First pitfall warning',
      confidence: 0.8,
    });
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Second pitfall warning',
      confidence: 0.6,
    });

    const result = await elaborationService.elaborateGoal(makeGoal());

    // Should be one clarification containing both pitfalls
    const pitfallClarification = result.clarifications.find(c => c.includes('relevant pitfall'));
    expect(pitfallClarification).toBeDefined();
    expect(pitfallClarification).toContain('2 relevant pitfall(s)');
    expect(pitfallClarification).toContain('First pitfall warning');
    expect(pitfallClarification).toContain('Second pitfall warning');
    expect(pitfallClarification).toContain('[Known pitfall, confidence 0.8]');
    expect(pitfallClarification).toContain('[Known pitfall, confidence 0.6]');
  });
});
