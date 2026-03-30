/**
 * Integration test: extractFromContextPack → ElaborationService flywheel
 *
 * Proves the full extraction flywheel: ContextPack data → extractFromContextPack()
 * → pitfalls stored in global_knowledge DB → ElaborationService.elaborateGoal()
 * retrieves and injects them as clarifications.
 *
 * This is the production path used by `pb learn` feeding into elaboration's read path.
 *
 * Real: GlobalKnowledgeService, ElaborationService, SQLite DB
 * Mocked: Repository (only ElaborationService's updateGoalStatus/createEscalation)
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { GlobalKnowledgeService } from '../../src/domain/knowledge/global-knowledge-service.js';
import { ElaborationService } from '../../src/app/lifecycle/elaboration/elaboration-service.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { Goal, ContextPack } from '../../src/work-order/types/index.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

function insertGoal(db: Database.Database, goalId: string): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO goals (id, created_at, updated_at, title, description, success_criteria, status, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(goalId, now, now, 'Source Goal', 'Source goal for context pack', '[]', 'completed', 50);
}

function makeContextPack(overrides?: Partial<{
  goalId: string;
  packId: string;
  pitfalls: string[];
  patterns: string[];
  approaches: string[];
}>): ContextPack {
  return {
    id: overrides?.packId ?? 'pack-1',
    created_at: Date.now(),
    goal_id: overrides?.goalId ?? 'goal-source',
    pack_type: 'daily_checkpoint',
    compressed: false,
    size_bytes: 100,
    snapshot_data: {
      goal_state: {
        current_work_items: [],
        completed_work_items: [],
        blocked_work_items: [],
        recent_decisions: [],
        active_escalations: [],
      },
      execution_summary: {
        total_runs: 3,
        success_count: 1,
        failure_count: 2,
        most_common_errors: [{ signature: 'TypeError: undefined is not a function', count: 2 }],
      },
      knowledge_base: {
        pitfalls_discovered: overrides?.pitfalls ?? ['Never use eval() in production code'],
        learned_patterns: overrides?.patterns ?? ['Prefer composition over inheritance'],
        successful_approaches: overrides?.approaches ?? ['Test-first development'],
      },
      next_actions: {
        recommended_work_items: [],
        risk_factors: [],
      },
    },
  } as ContextPack;
}

function makeGoal(overrides?: Partial<Goal>): Goal {
  return {
    id: 'goal-new',
    title: 'New Goal That Needs Knowledge',
    description: 'A sufficiently long goal description that exceeds the fifty character minimum threshold for proper elaboration',
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

describe('Integration: extractFromContextPack → ElaborationService flywheel', () => {
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

  test('pitfalls extracted from ContextPack appear in elaboration, patterns and approaches do not', async () => {
    insertGoal(db, 'goal-source');

    const pack = makeContextPack({
      goalId: 'goal-source',
      pitfalls: ['Never use eval() in production code', 'Always validate user input'],
      patterns: ['Use dependency injection for testability'],
      approaches: ['Write integration tests first'],
    });

    // Extract knowledge from ContextPack (simulates `pb learn`)
    const extracted = knowledgeService.extractFromContextPack(pack);
    expect(extracted).toHaveLength(4); // 2 pitfalls + 1 pattern + 1 approach

    // Now elaborate a new goal — only pitfalls (and constraint/failure_mode) should appear
    const result = await elaborationService.elaborateGoal(makeGoal());

    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('Never use eval() in production code');
    expect(knowledgeBlock).toContain('Always validate user input');

    // Patterns and approaches should NOT appear in clarifications (not in queried types)
    expect(knowledgeBlock).not.toContain('dependency injection');
    expect(knowledgeBlock).not.toContain('integration tests first');
  });

  test('duplicate extraction reinforces confidence rather than creating duplicates', async () => {
    insertGoal(db, 'goal-source');
    insertGoal(db, 'goal-source-2');

    const pack1 = makeContextPack({
      goalId: 'goal-source',
      packId: 'pack-1',
      pitfalls: ['Never use eval()'],
      patterns: [],
      approaches: [],
    });

    const pack2 = makeContextPack({
      goalId: 'goal-source-2',
      packId: 'pack-2',
      pitfalls: ['Never use eval()'], // Same pitfall from different goal
      patterns: [],
      approaches: [],
    });

    knowledgeService.extractFromContextPack(pack1);
    knowledgeService.extractFromContextPack(pack2);

    // Should be 1 unique pitfall, not 2 (dedup by content + type)
    const allPitfalls = knowledgeService.list({ knowledgeType: 'pitfall' });
    expect(allPitfalls).toHaveLength(1);
    expect(allPitfalls[0].occurrence_count).toBe(2);
    // Confidence should be reinforced (0.5 default + 0.1 = 0.6)
    expect(allPitfalls[0].confidence).toBeCloseTo(0.6, 1);

    // Elaboration should show the pitfall with reinforced confidence in structured format
    const result = await elaborationService.elaborateGoal(makeGoal());
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('[PITFALL] Never use eval() (confidence: 0.6)');
  });

  test('extracted pitfall with default confidence (0.5) meets the 0.5 threshold', async () => {
    insertGoal(db, 'goal-source');

    const pack = makeContextPack({
      goalId: 'goal-source',
      pitfalls: ['Watch out for circular imports'],
      patterns: [],
      approaches: [],
    });

    knowledgeService.extractFromContextPack(pack);

    // Default confidence is 0.5 which meets the 0.5 threshold (>=)
    const result = await elaborationService.elaborateGoal(makeGoal());
    const knowledgeBlock = result.clarifications.find(c => c.includes('KNOWN CONSTRAINTS AND PITFALLS:'));
    expect(knowledgeBlock).toBeDefined();
    expect(knowledgeBlock).toContain('Watch out for circular imports');
    expect(knowledgeBlock).toContain('[PITFALL]');
    expect(knowledgeBlock).toContain('(confidence: 0.5)');
  });

  test('well-formed goal with knowledge gets only knowledge clarification, no noise', async () => {
    insertGoal(db, 'goal-source');

    const pack = makeContextPack({
      goalId: 'goal-source',
      pitfalls: ['Beware of race conditions in async code'],
      patterns: [],
      approaches: [],
    });

    knowledgeService.extractFromContextPack(pack);

    // Goal has success criteria, budget, long description — no validation clarifications
    const result = await elaborationService.elaborateGoal(makeGoal());

    // The only clarification should be the structured knowledge injection
    expect(result.escalations).toHaveLength(0);
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0]).toContain('Beware of race conditions');
    expect(result.clarifications[0]).toContain('KNOWN CONSTRAINTS AND PITFALLS:');
  });
});
