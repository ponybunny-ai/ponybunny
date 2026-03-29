/**
 * Plan Review RPC Handlers Tests
 *
 * Tests the plan.get, plan.approve, and plan.reject RPC handlers
 * that allow clients to inspect and approve/reject planned work items.
 */

import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { EventBus } from '../../../src/gateway/events/event-bus.js';
import { registerPlanReviewHandlers } from '../../../src/gateway/rpc/handlers/plan-review-handlers.js';

function createSession(permissions: Array<'read' | 'write' | 'admin'> = ['read', 'write']): Session {
  return new Session({
    id: 'sess-plan-1',
    publicKey: 'pk-plan',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

function makeGoal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'goal-1',
    title: 'Test Goal',
    description: 'A test goal',
    status: 'plan_review',
    ...overrides,
  };
}

function makeWorkItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wi-1',
    goal_id: 'goal-1',
    title: 'Test Work Item',
    status: 'queued',
    ...overrides,
  };
}

describe('plan review handlers', () => {
  let rpc: RpcHandler;
  let session: Session;
  let eventBus: EventBus;
  let repository: {
    getGoal: jest.Mock;
    getWorkItemsByGoal: jest.Mock;
    updateGoalStatus: jest.Mock;
  };
  let ipcBridge: {
    approvePlan: jest.Mock;
  };

  beforeEach(() => {
    rpc = new RpcHandler();
    session = createSession();
    eventBus = new EventBus();

    repository = {
      getGoal: jest.fn(),
      getWorkItemsByGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
    };

    ipcBridge = {
      approvePlan: jest.fn().mockResolvedValue(undefined),
    };

    registerPlanReviewHandlers(
      rpc,
      repository as any,
      ipcBridge as any,
      eventBus,
    );
  });

  describe('plan.get', () => {
    it('returns work items for a goal', async () => {
      const goal = makeGoal();
      const workItems = [makeWorkItem(), makeWorkItem({ id: 'wi-2', title: 'Second item' })];

      repository.getGoal.mockReturnValue(goal);
      repository.getWorkItemsByGoal.mockReturnValue(workItems);

      const result = await rpc.handle('plan.get', { goalId: 'goal-1' }, session) as {
        goalId: string;
        status: string;
        workItems: unknown[];
      };

      expect(result.goalId).toBe('goal-1');
      expect(result.status).toBe('plan_review');
      expect(result.workItems).toEqual(workItems);
      expect(repository.getWorkItemsByGoal).toHaveBeenCalledWith('goal-1');
    });

    it('throws for nonexistent goal', async () => {
      repository.getGoal.mockReturnValue(undefined);

      await expect(
        rpc.handle('plan.get', { goalId: 'nonexistent' }, session)
      ).rejects.toThrow('goal not found: nonexistent');
    });

    it('throws when goalId is missing', async () => {
      await expect(
        rpc.handle('plan.get', {}, session)
      ).rejects.toThrow('goalId is required');
    });
  });

  describe('plan.approve', () => {
    it('calls ipcBridge.approvePlan and emits event', async () => {
      const goal = makeGoal({ id: 'goal-pr', status: 'plan_review' });
      repository.getGoal.mockReturnValue(goal);

      const emitted: unknown[] = [];
      eventBus.on('plan.approved', (data) => emitted.push(data));

      const result = await rpc.handle('plan.approve', { goalId: 'goal-pr' }, session) as { success: boolean };

      expect(result.success).toBe(true);
      expect(ipcBridge.approvePlan).toHaveBeenCalledWith('goal-pr');
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        goalId: 'goal-pr',
        approvedBy: 'pk-plan',
      });
    });

    it('throws if goal is not in plan_review status', async () => {
      const goal = makeGoal({ id: 'goal-active', status: 'active' });
      repository.getGoal.mockReturnValue(goal);

      await expect(
        rpc.handle('plan.approve', { goalId: 'goal-active' }, session)
      ).rejects.toThrow('Goal goal-active is not in plan_review status (current: active)');

      expect(ipcBridge.approvePlan).not.toHaveBeenCalled();
    });

    it('throws when goalId is missing', async () => {
      await expect(
        rpc.handle('plan.approve', {}, session)
      ).rejects.toThrow('goalId is required');
    });

    it('throws when goal not found', async () => {
      repository.getGoal.mockReturnValue(undefined);

      await expect(
        rpc.handle('plan.approve', { goalId: 'nonexistent' }, session)
      ).rejects.toThrow('goal not found: nonexistent');
    });
  });

  describe('plan.reject', () => {
    it('cancels the goal and emits event', async () => {
      const goal = makeGoal({ id: 'goal-pr', status: 'plan_review' });
      repository.getGoal.mockReturnValue(goal);

      const emitted: unknown[] = [];
      eventBus.on('plan.rejected', (data) => emitted.push(data));

      const result = await rpc.handle('plan.reject', { goalId: 'goal-pr', reason: 'Too many items' }, session) as { success: boolean };

      expect(result.success).toBe(true);
      expect(repository.updateGoalStatus).toHaveBeenCalledWith('goal-pr', 'cancelled');
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual({
        goalId: 'goal-pr',
        reason: 'Too many items',
        rejectedBy: 'pk-plan',
      });
    });

    it('throws if goal is not in plan_review status', async () => {
      const goal = makeGoal({ id: 'goal-active', status: 'active' });
      repository.getGoal.mockReturnValue(goal);

      await expect(
        rpc.handle('plan.reject', { goalId: 'goal-active' }, session)
      ).rejects.toThrow('Goal goal-active is not in plan_review status (current: active)');

      expect(repository.updateGoalStatus).not.toHaveBeenCalled();
    });

    it('throws when goalId is missing', async () => {
      await expect(
        rpc.handle('plan.reject', {}, session)
      ).rejects.toThrow('goalId is required');
    });

    it('throws when goal not found', async () => {
      repository.getGoal.mockReturnValue(undefined);

      await expect(
        rpc.handle('plan.reject', { goalId: 'nonexistent' }, session)
      ).rejects.toThrow('goal not found: nonexistent');
    });
  });
});
