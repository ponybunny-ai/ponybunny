/**
 * Integration test: GlobalKnowledgeService → ElaborationService structured knowledge injection
 *
 * Proves the core flywheel link: knowledge recorded in global_knowledge via
 * GlobalKnowledgeService.record() is retrieved and injected as structured
 * clarifications by ElaborationService.elaborateGoal() when both share the
 * same real SQLite DB.
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

describe('Integration: GlobalKnowledgeService → ElaborationService structured knowledge injection', () => {
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

  test('pitfall recorded via record() appears in structured knowledge block', async () => {
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
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('[PITFALL] Always verify services are wired into all execution paths (confidence: 0.8)');
  });

  test('pitfall with confidence below 0.5 threshold is NOT injected', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Low confidence pitfall that should be filtered out',
      confidence: 0.3,
    });

    const result = await elaborationService.elaborateGoal(makeGoal());

    // No knowledge clarifications should appear (confidence below 0.5 threshold)
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeUndefined();
  });

  test('at most 10 knowledge entries are injected (limit enforcement)', async () => {
    // Record 12 pitfalls above threshold
    for (let i = 0; i < 12; i++) {
      knowledgeService.record({
        knowledge_type: 'pitfall',
        content: `Pitfall number ${i + 1} that should be considered`,
        confidence: 0.5 + i * 0.03,
      });
    }

    const result = await elaborationService.elaborateGoal(makeGoal());

    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    // Count [PITFALL] entries — should be at most 10
    const pitfallCount = (knowledgeBlock!.match(/\[PITFALL\]/g) || []).length;
    expect(pitfallCount).toBeLessThanOrEqual(10);
    expect(pitfallCount).toBe(10);
  });

  test('no knowledge recorded → no knowledge clarifications', async () => {
    const result = await elaborationService.elaborateGoal(makeGoal());

    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeUndefined();
    expect(result.escalations).toHaveLength(0);
  });

  test('only pitfall, constraint, failure_mode types are injected, not patterns or approaches', async () => {
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

    // No knowledge block since only patterns/approaches were recorded (not in queried types)
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeUndefined();
  });

  test('graceful degradation when knowledge DB is closed', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'This pitfall should not crash',
      confidence: 0.8,
    });

    // Close DB to simulate failure
    db.close();

    // ElaborationService should catch the error and continue without knowledge
    const result = await elaborationService.elaborateGoal(makeGoal());

    // Should succeed without knowledge clarifications
    expect(result.escalations).toHaveLength(0);
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeUndefined();
  });

  test('multiple knowledge entries are consolidated into a single structured block', async () => {
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

    // Should be one clarification block containing both entries
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('[PITFALL] First pitfall warning (confidence: 0.8)');
    expect(knowledgeBlock).toContain('[PITFALL] Second pitfall warning (confidence: 0.6)');
  });

  test('constraint and failure_mode types are also injected alongside pitfalls', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Never use eval()',
      confidence: 0.8,
    });
    knowledgeService.record({
      knowledge_type: 'constraint',
      content: 'GitHub API rate limit 5000 req/hr',
      confidence: 0.9,
    });
    knowledgeService.record({
      knowledge_type: 'failure_mode',
      content: 'OOM on inputs > 10MB',
      confidence: 0.7,
    });

    const result = await elaborationService.elaborateGoal(makeGoal());

    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('[PITFALL] Never use eval() (confidence: 0.8)');
    expect(knowledgeBlock).toContain('[CONSTRAINT] GitHub API rate limit 5000 req/hr (confidence: 0.9)');
    expect(knowledgeBlock).toContain('[FAILURE_MODE] OOM on inputs > 10MB (confidence: 0.7)');
  });
});
