import {
  prefixedAction,
  actorTypeToSource,
  hasPrefixedFormat,
  PREFIXED_ACTIONS,
} from '../../../src/domain/audit/audit-naming.js';
import type { ActorType } from '../../../src/domain/audit/types.js';

describe('audit-naming', () => {
  // ==========================================================================
  // prefixedAction
  // ==========================================================================

  describe('prefixedAction', () => {
    it('builds a correctly formatted string from parts', () => {
      expect(prefixedAction('user', 'goal', 'submit')).toBe('user.goal.submit');
    });

    it('works for system source', () => {
      expect(prefixedAction('system', 'budget', 'exceeded')).toBe('system.budget.exceeded');
    });

    it('works for agent source', () => {
      expect(prefixedAction('agent', 'tool', 'call')).toBe('agent.tool.call');
    });

    it('handles underscored entity and verb names', () => {
      expect(prefixedAction('system', 'work_item', 'status_changed')).toBe(
        'system.work_item.status_changed',
      );
    });
  });

  // ==========================================================================
  // actorTypeToSource
  // ==========================================================================

  describe('actorTypeToSource', () => {
    it('maps user to user', () => {
      expect(actorTypeToSource('user')).toBe('user');
    });

    it('maps agent to agent', () => {
      expect(actorTypeToSource('agent')).toBe('agent');
    });

    it.each<ActorType>(['system', 'daemon', 'scheduler', 'gateway'])(
      'maps %s to system',
      (actorType) => {
        expect(actorTypeToSource(actorType)).toBe('system');
      },
    );

    it('covers every ActorType value', () => {
      // Exhaustiveness: if a new ActorType is added and not handled,
      // TypeScript compilation will fail in the switch statement.
      // This test documents the full set at time of writing.
      const allActorTypes: ActorType[] = [
        'user',
        'system',
        'daemon',
        'agent',
        'scheduler',
        'gateway',
      ];

      for (const at of allActorTypes) {
        const result = actorTypeToSource(at);
        expect(['user', 'system', 'agent']).toContain(result);
      }
    });
  });

  // ==========================================================================
  // PREFIXED_ACTIONS constants
  // ==========================================================================

  describe('PREFIXED_ACTIONS', () => {
    it('contains only well-formed prefixed action strings', () => {
      for (const [key, value] of Object.entries(PREFIXED_ACTIONS)) {
        // Each value should have at least two dots: source.entity.verb
        const parts = value.split('.');
        expect(parts.length).toBeGreaterThanOrEqual(3);
        expect(['user', 'system', 'agent']).toContain(parts[0]);
        // Key should be non-empty
        expect(key.length).toBeGreaterThan(0);
      }
    });

    it('all values start with a valid source prefix', () => {
      for (const value of Object.values(PREFIXED_ACTIONS)) {
        expect(hasPrefixedFormat(value)).toBe(true);
      }
    });

    it('user actions start with user.', () => {
      expect(PREFIXED_ACTIONS.USER_GOAL_SUBMIT).toMatch(/^user\./);
      expect(PREFIXED_ACTIONS.USER_GOAL_CANCEL).toMatch(/^user\./);
      expect(PREFIXED_ACTIONS.USER_PERMISSION_GRANT).toMatch(/^user\./);
      expect(PREFIXED_ACTIONS.USER_PERMISSION_DENY).toMatch(/^user\./);
      expect(PREFIXED_ACTIONS.USER_ESCALATION_RESOLVE).toMatch(/^user\./);
      expect(PREFIXED_ACTIONS.USER_PLAN_APPROVE).toMatch(/^user\./);
      expect(PREFIXED_ACTIONS.USER_PLAN_REJECT).toMatch(/^user\./);
    });

    it('system actions start with system.', () => {
      expect(PREFIXED_ACTIONS.SYSTEM_WORKITEM_RETRY).toMatch(/^system\./);
      expect(PREFIXED_ACTIONS.SYSTEM_BUDGET_EXCEEDED).toMatch(/^system\./);
      expect(PREFIXED_ACTIONS.SYSTEM_GOAL_EVALUATED).toMatch(/^system\./);
      expect(PREFIXED_ACTIONS.SYSTEM_CIRCUIT_OPENED).toMatch(/^system\./);
    });

    it('agent actions start with agent.', () => {
      expect(PREFIXED_ACTIONS.AGENT_TOOL_CALL).toMatch(/^agent\./);
      expect(PREFIXED_ACTIONS.AGENT_TOOL_COMPLETE).toMatch(/^agent\./);
      expect(PREFIXED_ACTIONS.AGENT_DECISION_RECORDED).toMatch(/^agent\./);
    });
  });

  // ==========================================================================
  // hasPrefixedFormat
  // ==========================================================================

  describe('hasPrefixedFormat', () => {
    it('returns true for valid prefixed actions', () => {
      expect(hasPrefixedFormat('user.goal.submit')).toBe(true);
      expect(hasPrefixedFormat('system.circuit.opened')).toBe(true);
      expect(hasPrefixedFormat('agent.tool.call')).toBe(true);
    });

    it('returns false for legacy entity.verb format', () => {
      expect(hasPrefixedFormat('goal.created')).toBe(false);
      expect(hasPrefixedFormat('tool.invoked')).toBe(false);
      expect(hasPrefixedFormat('escalation.resolved')).toBe(false);
    });

    it('returns false for strings without dots', () => {
      expect(hasPrefixedFormat('noDots')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasPrefixedFormat('')).toBe(false);
    });

    it('returns false for unknown prefix', () => {
      expect(hasPrefixedFormat('admin.goal.create')).toBe(false);
    });
  });
});
