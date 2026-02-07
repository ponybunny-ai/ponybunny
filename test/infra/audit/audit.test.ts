import Database from 'better-sqlite3';
import { AuditLogRepository } from '../../../src/infra/persistence/audit-repository.js';
import { AuditService } from '../../../src/infra/audit/audit-service.js';
import type { AuditAction, AuditEntityType } from '../../../src/domain/audit/types.js';

describe('AuditLogRepository', () => {
  let db: Database.Database;
  let repository: AuditLogRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repository = new AuditLogRepository(db);
    repository.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe('log', () => {
    it('should create an audit log entry', () => {
      const entry = repository.log({
        actor: 'user-123',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-456',
        goal_id: 'goal-456',
        new_value: { title: 'Test Goal' },
      });

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.actor).toBe('user-123');
      expect(entry.action).toBe('goal.created');
      expect(entry.entity_id).toBe('goal-456');
    });

    it('should store and retrieve JSON values correctly', () => {
      const entry = repository.log({
        actor: 'system',
        actor_type: 'system',
        action: 'goal.status_changed',
        entity_type: 'goal',
        entity_id: 'goal-789',
        old_value: { status: 'queued' },
        new_value: { status: 'active' },
        metadata: { reason: 'auto-activated' },
      });

      const retrieved = repository.getById(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.old_value).toEqual({ status: 'queued' });
      expect(retrieved!.new_value).toEqual({ status: 'active' });
      expect(retrieved!.metadata).toEqual({ reason: 'auto-activated' });
    });
  });

  describe('logBatch', () => {
    it('should create multiple audit log entries in a transaction', () => {
      const entries = repository.logBatch([
        {
          actor: 'user-1',
          actor_type: 'user',
          action: 'goal.created',
          entity_type: 'goal',
          entity_id: 'goal-1',
        },
        {
          actor: 'user-1',
          actor_type: 'user',
          action: 'work_item.created',
          entity_type: 'work_item',
          entity_id: 'item-1',
          goal_id: 'goal-1',
        },
        {
          actor: 'agent',
          actor_type: 'agent',
          action: 'run.started',
          entity_type: 'run',
          entity_id: 'run-1',
          goal_id: 'goal-1',
        },
      ]);

      expect(entries).toHaveLength(3);
      expect(repository.count()).toBe(3);
    });
  });

  describe('getByGoalId', () => {
    it('should return all logs for a goal', () => {
      repository.log({
        actor: 'user-1',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-1',
        goal_id: 'goal-1',
      });

      repository.log({
        actor: 'system',
        actor_type: 'system',
        action: 'work_item.created',
        entity_type: 'work_item',
        entity_id: 'item-1',
        goal_id: 'goal-1',
      });

      repository.log({
        actor: 'user-2',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-2',
        goal_id: 'goal-2',
      });

      const logs = repository.getByGoalId('goal-1');
      expect(logs).toHaveLength(2);
      expect(logs.every(l => l.goal_id === 'goal-1')).toBe(true);
    });
  });

  describe('getByAction', () => {
    it('should return logs filtered by action', () => {
      repository.log({
        actor: 'user-1',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-1',
      });

      repository.log({
        actor: 'system',
        actor_type: 'system',
        action: 'goal.status_changed',
        entity_type: 'goal',
        entity_id: 'goal-1',
      });

      repository.log({
        actor: 'user-2',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-2',
      });

      const logs = repository.getByAction('goal.created');
      expect(logs).toHaveLength(2);
    });
  });

  describe('getByActionPrefix', () => {
    it('should return logs filtered by action prefix', () => {
      repository.log({
        actor: 'user-1',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-1',
      });

      repository.log({
        actor: 'system',
        actor_type: 'system',
        action: 'goal.status_changed',
        entity_type: 'goal',
        entity_id: 'goal-1',
      });

      repository.log({
        actor: 'agent',
        actor_type: 'agent',
        action: 'run.started',
        entity_type: 'run',
        entity_id: 'run-1',
      });

      const goalLogs = repository.getByActionPrefix('goal.');
      expect(goalLogs).toHaveLength(2);

      const runLogs = repository.getByActionPrefix('run.');
      expect(runLogs).toHaveLength(1);
    });
  });

  describe('prune', () => {
    it('should delete old audit logs', async () => {
      // Create some logs
      repository.log({
        actor: 'user-1',
        actor_type: 'user',
        action: 'goal.created',
        entity_type: 'goal',
        entity_id: 'goal-1',
      });

      expect(repository.count()).toBe(1);

      // Wait a bit so the log becomes "old"
      await new Promise(resolve => setTimeout(resolve, 10));

      // Prune logs older than 5ms
      const deleted = repository.prune(5);
      expect(deleted).toBe(1);
      expect(repository.count()).toBe(0);
    });
  });

  describe('getStatistics', () => {
    it('should return statistics about audit logs', () => {
      repository.logBatch([
        {
          actor: 'user-1',
          actor_type: 'user',
          action: 'goal.created',
          entity_type: 'goal',
          entity_id: 'goal-1',
        },
        {
          actor: 'system',
          actor_type: 'system',
          action: 'goal.status_changed',
          entity_type: 'goal',
          entity_id: 'goal-1',
        },
        {
          actor: 'agent',
          actor_type: 'agent',
          action: 'tool.invoked',
          entity_type: 'tool',
          entity_id: 'read_file',
        },
      ]);

      const stats = repository.getStatistics();
      expect(stats.total).toBe(3);
      expect(stats.by_action['goal.created']).toBe(1);
      expect(stats.by_action['goal.status_changed']).toBe(1);
      expect(stats.by_action['tool.invoked']).toBe(1);
      expect(stats.by_entity_type['goal']).toBe(2);
      expect(stats.by_entity_type['tool']).toBe(1);
      expect(stats.by_actor_type['user']).toBe(1);
      expect(stats.by_actor_type['system']).toBe(1);
      expect(stats.by_actor_type['agent']).toBe(1);
    });
  });
});

describe('AuditService', () => {
  let db: Database.Database;
  let repository: AuditLogRepository;
  let service: AuditService;

  beforeEach(() => {
    db = new Database(':memory:');
    repository = new AuditLogRepository(db);
    repository.initialize();
    service = new AuditService(repository);
  });

  afterEach(() => {
    db.close();
  });

  describe('Goal operations', () => {
    it('should log goal created', () => {
      service.logGoalCreated('goal-1', 'user-123', 'user', {
        title: 'Test Goal',
        description: 'A test goal',
      });

      const logs = repository.getByGoalId('goal-1');
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('goal.created');
      expect(logs[0].actor).toBe('user-123');
    });

    it('should log goal status changed', () => {
      service.logGoalStatusChanged('goal-1', 'scheduler', 'scheduler', 'queued', 'active');

      const logs = repository.getByGoalId('goal-1');
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('goal.status_changed');
      expect(logs[0].old_value).toEqual({ status: 'queued' });
      expect(logs[0].new_value).toEqual({ status: 'active' });
    });
  });

  describe('Tool operations', () => {
    it('should log tool invoked with sanitized args', () => {
      service.logToolInvoked('write_file', 'run-1', 'item-1', 'goal-1', {
        path: '/tmp/test.txt',
        content: 'Hello World',
        password: 'secret123',
      });

      const logs = repository.getByActionPrefix('tool.');
      expect(logs).toHaveLength(1);
      expect(logs[0].new_value).toEqual({
        path: '/tmp/test.txt',
        content: 'Hello World',
        password: '[REDACTED]',
      });
    });

    it('should log tool blocked', () => {
      service.logToolBlocked('shell', 'run-1', 'item-1', 'goal-1', 'Command not in allowlist');

      const logs = repository.getByAction('tool.blocked');
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toEqual({ reason: 'Command not in allowlist' });
    });
  });

  describe('Escalation operations', () => {
    it('should log escalation lifecycle', () => {
      service.logEscalationCreated('esc-1', 'item-1', 'goal-1', 'stuck', 'high');
      service.logEscalationAcknowledged('esc-1', 'item-1', 'goal-1', 'user-123');
      service.logEscalationResolved('esc-1', 'item-1', 'goal-1', 'user-123', 'retry');

      const logs = repository.getByActionPrefix('escalation.');
      expect(logs).toHaveLength(3);

      const actions = logs.map(l => l.action).sort();
      expect(actions).toEqual([
        'escalation.acknowledged',
        'escalation.created',
        'escalation.resolved',
      ]);
    });
  });

  describe('Query operations', () => {
    it('should get logs for goal', () => {
      service.logGoalCreated('goal-1', 'user-1', 'user', { title: 'Goal 1' });
      service.logWorkItemCreated('item-1', 'goal-1', 'system', 'system', { title: 'Item 1' });
      service.logGoalCreated('goal-2', 'user-1', 'user', { title: 'Goal 2' });

      const logs = service.getLogsForGoal('goal-1');
      expect(logs).toHaveLength(2);
    });

    it('should get recent logs', () => {
      service.logGoalCreated('goal-1', 'user-1', 'user', { title: 'Goal 1' });
      service.logGoalCreated('goal-2', 'user-1', 'user', { title: 'Goal 2' });
      service.logGoalCreated('goal-3', 'user-1', 'user', { title: 'Goal 3' });

      const logs = service.getRecentLogs(2);
      expect(logs).toHaveLength(2);
    });
  });
});
