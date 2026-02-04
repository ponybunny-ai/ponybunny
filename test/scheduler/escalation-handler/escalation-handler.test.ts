import { EscalationHandler } from '../../../src/scheduler/escalation-handler/escalation-handler.js';
import type { EscalationCreateParams } from '../../../src/scheduler/escalation-handler/types.js';

describe('EscalationHandler', () => {
  let handler: EscalationHandler;

  const createParams = (overrides: Partial<EscalationCreateParams> = {}): EscalationCreateParams => ({
    workItemId: 'wi-1',
    goalId: 'goal-1',
    type: 'stuck',
    severity: 'medium',
    title: 'Test Escalation',
    description: 'Test description',
    ...overrides,
  });

  beforeEach(() => {
    handler = new EscalationHandler();
  });

  describe('createEscalation', () => {
    it('should create an escalation with open status', async () => {
      const params = createParams();

      const escalation = await handler.createEscalation(params);

      expect(escalation.id).toBeDefined();
      expect(escalation.status).toBe('open');
      expect(escalation.work_item_id).toBe('wi-1');
      expect(escalation.goal_id).toBe('goal-1');
      expect(escalation.escalation_type).toBe('stuck');
      expect(escalation.severity).toBe('medium');
      expect(escalation.title).toBe('Test Escalation');
    });

    it('should include optional run_id', async () => {
      const params = createParams({ runId: 'run-1' });

      const escalation = await handler.createEscalation(params);

      expect(escalation.run_id).toBe('run-1');
    });

    it('should include context data', async () => {
      const params = createParams({
        context: {
          error_signature: 'abc123',
          retry_count: 3,
        },
      });

      const escalation = await handler.createEscalation(params);

      expect(escalation.context_data?.error_signature).toBe('abc123');
      expect(escalation.context_data?.retry_count).toBe(3);
    });
  });

  describe('resolveEscalation', () => {
    it('should resolve an open escalation', async () => {
      const escalation = await handler.createEscalation(createParams());

      await handler.resolveEscalation({
        escalationId: escalation.id,
        action: 'user_input',
        resolver: 'user@example.com',
        data: { input: 'some value' },
      });

      const resolved = await handler.getEscalation(escalation.id);
      expect(resolved?.status).toBe('resolved');
      expect(resolved?.resolution_action).toBe('user_input');
      expect(resolved?.resolver).toBe('user@example.com');
      expect(resolved?.resolved_at).toBeDefined();
    });

    it('should throw for non-existent escalation', async () => {
      await expect(
        handler.resolveEscalation({
          escalationId: 'non-existent',
          action: 'skip',
          resolver: 'user',
        })
      ).rejects.toThrow('Escalation not found');
    });

    it('should throw for already resolved escalation', async () => {
      const escalation = await handler.createEscalation(createParams());
      await handler.resolveEscalation({
        escalationId: escalation.id,
        action: 'skip',
        resolver: 'user',
      });

      await expect(
        handler.resolveEscalation({
          escalationId: escalation.id,
          action: 'retry',
          resolver: 'user',
        })
      ).rejects.toThrow('already closed');
    });
  });

  describe('acknowledgeEscalation', () => {
    it('should acknowledge an open escalation', async () => {
      const escalation = await handler.createEscalation(createParams());

      await handler.acknowledgeEscalation(escalation.id, 'user@example.com');

      const acknowledged = await handler.getEscalation(escalation.id);
      expect(acknowledged?.status).toBe('acknowledged');
    });

    it('should throw for non-existent escalation', async () => {
      await expect(
        handler.acknowledgeEscalation('non-existent', 'user')
      ).rejects.toThrow('Escalation not found');
    });

    it('should throw for non-open escalation', async () => {
      const escalation = await handler.createEscalation(createParams());
      await handler.acknowledgeEscalation(escalation.id, 'user');

      await expect(
        handler.acknowledgeEscalation(escalation.id, 'user')
      ).rejects.toThrow('Can only acknowledge open escalations');
    });
  });

  describe('dismissEscalation', () => {
    it('should dismiss an escalation', async () => {
      const escalation = await handler.createEscalation(createParams());

      await handler.dismissEscalation(escalation.id, 'No longer relevant');

      const dismissed = await handler.getEscalation(escalation.id);
      expect(dismissed?.status).toBe('dismissed');
      expect(dismissed?.resolution_data).toEqual({ dismissReason: 'No longer relevant' });
    });

    it('should throw for already closed escalation', async () => {
      const escalation = await handler.createEscalation(createParams());
      await handler.dismissEscalation(escalation.id, 'reason');

      await expect(
        handler.dismissEscalation(escalation.id, 'another reason')
      ).rejects.toThrow('already closed');
    });
  });

  describe('getEscalation', () => {
    it('should return escalation by id', async () => {
      const created = await handler.createEscalation(createParams());

      const escalation = await handler.getEscalation(created.id);

      expect(escalation).toEqual(created);
    });

    it('should return null for non-existent id', async () => {
      const escalation = await handler.getEscalation('non-existent');

      expect(escalation).toBeNull();
    });
  });

  describe('getPendingEscalations', () => {
    it('should return open and acknowledged escalations', async () => {
      const e1 = await handler.createEscalation(createParams({ goalId: 'goal-1' }));
      const e2 = await handler.createEscalation(createParams({ goalId: 'goal-1' }));
      const e3 = await handler.createEscalation(createParams({ goalId: 'goal-1' }));
      await handler.acknowledgeEscalation(e2.id, 'user');
      await handler.resolveEscalation({
        escalationId: e3.id,
        action: 'skip',
        resolver: 'user',
      });

      const pending = await handler.getPendingEscalations('goal-1');

      expect(pending).toHaveLength(2);
      expect(pending.map((e) => e.id)).toContain(e1.id);
      expect(pending.map((e) => e.id)).toContain(e2.id);
    });

    it('should filter by goal id', async () => {
      await handler.createEscalation(createParams({ goalId: 'goal-1' }));
      await handler.createEscalation(createParams({ goalId: 'goal-2' }));

      const pending = await handler.getPendingEscalations('goal-1');

      expect(pending).toHaveLength(1);
      expect(pending[0].goal_id).toBe('goal-1');
    });

    it('should sort by severity then creation time', async () => {
      const e1 = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'low' })
      );
      const e2 = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'critical' })
      );
      const e3 = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'high' })
      );

      const pending = await handler.getPendingEscalations('goal-1');

      expect(pending[0].id).toBe(e2.id); // critical
      expect(pending[1].id).toBe(e3.id); // high
      expect(pending[2].id).toBe(e1.id); // low
    });
  });

  describe('getEscalations', () => {
    beforeEach(async () => {
      await handler.createEscalation(
        createParams({
          goalId: 'goal-1',
          workItemId: 'wi-1',
          type: 'stuck',
          severity: 'high',
        })
      );
      await handler.createEscalation(
        createParams({
          goalId: 'goal-1',
          workItemId: 'wi-2',
          type: 'ambiguous',
          severity: 'medium',
        })
      );
      await handler.createEscalation(
        createParams({
          goalId: 'goal-2',
          workItemId: 'wi-3',
          type: 'risk',
          severity: 'critical',
        })
      );
    });

    it('should filter by goalId', async () => {
      const escalations = await handler.getEscalations({ goalId: 'goal-1' });

      expect(escalations).toHaveLength(2);
      expect(escalations.every((e) => e.goal_id === 'goal-1')).toBe(true);
    });

    it('should filter by workItemId', async () => {
      const escalations = await handler.getEscalations({ workItemId: 'wi-1' });

      expect(escalations).toHaveLength(1);
      expect(escalations[0].work_item_id).toBe('wi-1');
    });

    it('should filter by type', async () => {
      const escalations = await handler.getEscalations({ type: 'stuck' });

      expect(escalations).toHaveLength(1);
      expect(escalations[0].escalation_type).toBe('stuck');
    });

    it('should filter by severity', async () => {
      const escalations = await handler.getEscalations({ severity: 'critical' });

      expect(escalations).toHaveLength(1);
      expect(escalations[0].severity).toBe('critical');
    });

    it('should filter by status', async () => {
      const all = await handler.getEscalations({});
      await handler.resolveEscalation({
        escalationId: all[0].id,
        action: 'skip',
        resolver: 'user',
      });

      const open = await handler.getEscalations({ status: 'open' });
      const resolved = await handler.getEscalations({ status: 'resolved' });

      expect(open).toHaveLength(2);
      expect(resolved).toHaveLength(1);
    });

    it('should combine multiple filters', async () => {
      const escalations = await handler.getEscalations({
        goalId: 'goal-1',
        severity: 'high',
      });

      expect(escalations).toHaveLength(1);
      expect(escalations[0].goal_id).toBe('goal-1');
      expect(escalations[0].severity).toBe('high');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const e1 = await handler.createEscalation(
        createParams({ type: 'stuck', severity: 'high' })
      );
      await handler.createEscalation(
        createParams({ type: 'ambiguous', severity: 'medium' })
      );
      await handler.createEscalation(
        createParams({ type: 'stuck', severity: 'critical' })
      );
      await handler.resolveEscalation({
        escalationId: e1.id,
        action: 'retry',
        resolver: 'user',
      });

      const stats = await handler.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byStatus.open).toBe(2);
      expect(stats.byStatus.resolved).toBe(1);
      expect(stats.bySeverity.high).toBe(1);
      expect(stats.bySeverity.medium).toBe(1);
      expect(stats.bySeverity.critical).toBe(1);
      expect(stats.byType.stuck).toBe(2);
      expect(stats.byType.ambiguous).toBe(1);
      expect(stats.averageResolutionTimeMs).toBeDefined();
    });

    it('should filter stats by goalId', async () => {
      await handler.createEscalation(createParams({ goalId: 'goal-1' }));
      await handler.createEscalation(createParams({ goalId: 'goal-1' }));
      await handler.createEscalation(createParams({ goalId: 'goal-2' }));

      const stats = await handler.getStats('goal-1');

      expect(stats.total).toBe(2);
    });
  });

  describe('hasBlockingEscalations', () => {
    it('should return true for critical severity', async () => {
      await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'critical', type: 'ambiguous' })
      );

      const hasBlocking = await handler.hasBlockingEscalations('goal-1');

      expect(hasBlocking).toBe(true);
    });

    it('should return true for high severity', async () => {
      await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'high', type: 'ambiguous' })
      );

      const hasBlocking = await handler.hasBlockingEscalations('goal-1');

      expect(hasBlocking).toBe(true);
    });

    it('should return true for blocking types', async () => {
      await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'low', type: 'stuck' })
      );

      const hasBlocking = await handler.hasBlockingEscalations('goal-1');

      expect(hasBlocking).toBe(true);
    });

    it('should return false for non-blocking escalations', async () => {
      await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'low', type: 'ambiguous' })
      );

      const hasBlocking = await handler.hasBlockingEscalations('goal-1');

      expect(hasBlocking).toBe(false);
    });

    it('should return false when no escalations', async () => {
      const hasBlocking = await handler.hasBlockingEscalations('goal-1');

      expect(hasBlocking).toBe(false);
    });

    it('should ignore resolved escalations', async () => {
      const e = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'critical' })
      );
      await handler.resolveEscalation({
        escalationId: e.id,
        action: 'skip',
        resolver: 'user',
      });

      const hasBlocking = await handler.hasBlockingEscalations('goal-1');

      expect(hasBlocking).toBe(false);
    });
  });

  describe('getHighestSeverityEscalation', () => {
    it('should return highest severity escalation', async () => {
      await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'low' })
      );
      const critical = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'critical' })
      );
      await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'medium' })
      );

      const highest = await handler.getHighestSeverityEscalation('goal-1');

      expect(highest?.id).toBe(critical.id);
    });

    it('should return null when no escalations', async () => {
      const highest = await handler.getHighestSeverityEscalation('goal-1');

      expect(highest).toBeNull();
    });

    it('should ignore resolved escalations', async () => {
      const critical = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'critical' })
      );
      const medium = await handler.createEscalation(
        createParams({ goalId: 'goal-1', severity: 'medium' })
      );
      await handler.resolveEscalation({
        escalationId: critical.id,
        action: 'skip',
        resolver: 'user',
      });

      const highest = await handler.getHighestSeverityEscalation('goal-1');

      expect(highest?.id).toBe(medium.id);
    });
  });
});
