import { AbortManager, withAbortSignal, abortableTimeout, isAbortError, runWithAbort } from '../../../src/app/execution/abort-manager.js';
import type { IAbortEvent } from '../../../src/domain/abort/types.js';

describe('AbortManager', () => {
  let manager: AbortManager;

  beforeEach(() => {
    manager = new AbortManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('register', () => {
    it('should register a new abort controller', () => {
      const signal = manager.register('goal', 'goal-1');

      expect(signal).toBeDefined();
      expect(signal.aborted).toBe(false);
    });

    it('should return existing signal if already registered', () => {
      const signal1 = manager.register('goal', 'goal-1');
      const signal2 = manager.register('goal', 'goal-1');

      expect(signal1).toBe(signal2);
    });

    it('should register with parent relationship', () => {
      manager.register('goal', 'goal-1');
      const signal = manager.register('work_item', 'item-1', { parentId: 'goal-1' });

      expect(signal).toBeDefined();
      expect(signal.aborted).toBe(false);
    });

    it('should register with timeout', async () => {
      const events: IAbortEvent[] = [];
      manager.onAbort(e => { events.push(e); });

      manager.register('run', 'run-1', { timeout: 50 });

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(manager.isAborted('run', 'run-1')).toBe(true);
      expect(events.some(e => e.type === 'abort_timeout')).toBe(true);
    });

    it('should update stats on registration', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1');

      const stats = manager.getStats();
      expect(stats.totalRegistered).toBe(2);
      expect(stats.activeRegistrations).toBe(2);
      expect(stats.byScope.goal).toBe(1);
      expect(stats.byScope.work_item).toBe(1);
    });
  });

  describe('getSignal', () => {
    it('should return signal for registered scope', () => {
      manager.register('goal', 'goal-1');
      const signal = manager.getSignal('goal', 'goal-1');

      expect(signal).toBeDefined();
    });

    it('should return undefined for unregistered scope', () => {
      const signal = manager.getSignal('goal', 'non-existent');

      expect(signal).toBeUndefined();
    });
  });

  describe('isAborted', () => {
    it('should return false for non-aborted scope', () => {
      manager.register('goal', 'goal-1');

      expect(manager.isAborted('goal', 'goal-1')).toBe(false);
    });

    it('should return true for aborted scope', () => {
      manager.register('goal', 'goal-1');
      manager.abort('goal', 'goal-1', 'Test abort');

      expect(manager.isAborted('goal', 'goal-1')).toBe(true);
    });

    it('should return false for non-existent scope', () => {
      expect(manager.isAborted('goal', 'non-existent')).toBe(false);
    });
  });

  describe('abort', () => {
    it('should abort a registered scope', () => {
      manager.register('goal', 'goal-1');
      const count = manager.abort('goal', 'goal-1', 'User cancelled');

      expect(count).toBe(1);
      expect(manager.isAborted('goal', 'goal-1')).toBe(true);
    });

    it('should return 0 for non-existent scope', () => {
      const count = manager.abort('goal', 'non-existent', 'Test');

      expect(count).toBe(0);
    });

    it('should cascade abort to children', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1', { parentId: 'goal-1' });
      manager.register('work_item', 'item-2', { parentId: 'goal-1' });

      const count = manager.abort('goal', 'goal-1', 'Cancel goal');

      expect(count).toBe(3); // 1 goal + 2 work items
      expect(manager.isAborted('goal', 'goal-1')).toBe(true);
      expect(manager.isAborted('work_item', 'item-1')).toBe(true);
      expect(manager.isAborted('work_item', 'item-2')).toBe(true);
    });

    it('should cascade through multiple levels', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1', { parentId: 'goal-1' });
      manager.register('run', 'run-1', { parentId: 'item-1' });

      const count = manager.abort('goal', 'goal-1', 'Cancel all');

      expect(count).toBe(3);
      expect(manager.isAborted('run', 'run-1')).toBe(true);
    });

    it('should store abort context', () => {
      manager.register('goal', 'goal-1');
      manager.abort('goal', 'goal-1', 'User request', 'user-123');

      const context = manager.getAbortContext('goal', 'goal-1');

      expect(context).toBeDefined();
      expect(context!.reason).toBe('User request');
      expect(context!.abortedBy).toBe('user-123');
      expect(context!.abortedAt).toBeDefined();
    });

    it('should emit abort event', () => {
      const events: IAbortEvent[] = [];
      manager.onAbort(e => { events.push(e); });

      manager.register('goal', 'goal-1');
      manager.abort('goal', 'goal-1', 'Test abort');

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('abort_requested');
      expect(events[0].scope).toBe('goal');
      expect(events[0].id).toBe('goal-1');
    });

    it('should update stats on abort', () => {
      manager.register('goal', 'goal-1');
      manager.abort('goal', 'goal-1', 'Test');

      const stats = manager.getStats();
      expect(stats.totalAborted).toBe(1);
    });
  });

  describe('abortChildren', () => {
    it('should abort all children of a parent', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1', { parentId: 'goal-1' });
      manager.register('work_item', 'item-2', { parentId: 'goal-1' });

      const count = manager.abortChildren('goal', 'goal-1', 'Cancel items');

      expect(count).toBe(2);
      expect(manager.isAborted('goal', 'goal-1')).toBe(false); // Parent not aborted
      expect(manager.isAborted('work_item', 'item-1')).toBe(true);
      expect(manager.isAborted('work_item', 'item-2')).toBe(true);
    });

    it('should return 0 if no children', () => {
      manager.register('goal', 'goal-1');

      const count = manager.abortChildren('goal', 'goal-1', 'No children');

      expect(count).toBe(0);
    });
  });

  describe('unregister', () => {
    it('should unregister a scope', () => {
      manager.register('goal', 'goal-1');
      const result = manager.unregister('goal', 'goal-1');

      expect(result).toBe(true);
      expect(manager.getSignal('goal', 'goal-1')).toBeUndefined();
    });

    it('should return false for non-existent scope', () => {
      const result = manager.unregister('goal', 'non-existent');

      expect(result).toBe(false);
    });

    it('should clear timeout on unregister', async () => {
      manager.register('run', 'run-1', { timeout: 100 });
      manager.unregister('run', 'run-1');

      // Wait past timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should not have been aborted since we unregistered
      expect(manager.getSignal('run', 'run-1')).toBeUndefined();
    });

    it('should update stats on unregister', () => {
      manager.register('goal', 'goal-1');
      manager.unregister('goal', 'goal-1');

      const stats = manager.getStats();
      expect(stats.activeRegistrations).toBe(0);
      expect(stats.byScope.goal).toBe(0);
    });
  });

  describe('unregisterChildren', () => {
    it('should unregister all children of a parent', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1', { parentId: 'goal-1' });
      manager.register('work_item', 'item-2', { parentId: 'goal-1' });

      const count = manager.unregisterChildren('goal', 'goal-1');

      expect(count).toBe(2);
      expect(manager.getSignal('goal', 'goal-1')).toBeDefined(); // Parent still exists
      expect(manager.getSignal('work_item', 'item-1')).toBeUndefined();
      expect(manager.getSignal('work_item', 'item-2')).toBeUndefined();
    });
  });

  describe('getActiveRegistrations', () => {
    it('should return all active registrations', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1');
      manager.abort('goal', 'goal-1', 'Test');

      const active = manager.getActiveRegistrations();

      expect(active.length).toBe(1);
      expect(active[0].id).toBe('item-1');
    });

    it('should filter by scope', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1');

      const active = manager.getActiveRegistrations('goal');

      expect(active.length).toBe(1);
      expect(active[0].scope).toBe('goal');
    });
  });

  describe('event handling', () => {
    it('should allow removing event handlers', () => {
      const events: IAbortEvent[] = [];
      const handler = (e: IAbortEvent) => { events.push(e); };

      manager.onAbort(handler);
      manager.register('goal', 'goal-1');
      manager.abort('goal', 'goal-1', 'First abort');

      manager.offAbort(handler);
      manager.register('goal', 'goal-2');
      manager.abort('goal', 'goal-2', 'Second abort');

      // Should only have events from first abort
      expect(events.filter(e => e.id === 'goal-1').length).toBeGreaterThan(0);
      expect(events.filter(e => e.id === 'goal-2').length).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all registrations', () => {
      manager.register('goal', 'goal-1');
      manager.register('work_item', 'item-1');
      manager.clear();

      const stats = manager.getStats();
      expect(stats.activeRegistrations).toBe(0);
      expect(stats.totalRegistered).toBe(0);
    });
  });
});

describe('Utility Functions', () => {
  describe('withAbortSignal', () => {
    it('should resolve when promise resolves', async () => {
      const controller = new AbortController();
      const result = await withAbortSignal(
        Promise.resolve('success'),
        controller.signal
      );

      expect(result).toBe('success');
    });

    it('should reject when signal is aborted', async () => {
      const controller = new AbortController();
      const promise = new Promise(resolve => setTimeout(() => resolve('late'), 100));

      setTimeout(() => controller.abort('cancelled'), 10);

      await expect(withAbortSignal(promise, controller.signal)).rejects.toThrow();
    });

    it('should reject immediately if already aborted', async () => {
      const controller = new AbortController();
      controller.abort('pre-aborted');

      await expect(
        withAbortSignal(Promise.resolve('value'), controller.signal)
      ).rejects.toThrow();
    });
  });

  describe('abortableTimeout', () => {
    it('should resolve after timeout', async () => {
      const controller = new AbortController();
      await expect(abortableTimeout(10, controller.signal)).resolves.toBeUndefined();
    });

    it('should reject when aborted', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort('cancelled'), 5);

      await expect(abortableTimeout(100, controller.signal)).rejects.toThrow();
    });
  });

  describe('isAbortError', () => {
    it('should return true for DOMException AbortError', () => {
      const error = new DOMException('Aborted', 'AbortError');
      expect(isAbortError(error)).toBe(true);
    });

    it('should return true for Error with aborted message', () => {
      const error = new Error('Operation was aborted');
      expect(isAbortError(error)).toBe(true);
    });

    it('should return false for other errors', () => {
      const error = new Error('Something else');
      expect(isAbortError(error)).toBe(false);
    });
  });

  describe('runWithAbort', () => {
    it('should run function successfully', async () => {
      const controller = new AbortController();
      const result = await runWithAbort(
        async () => 'result',
        controller.signal
      );

      expect(result).toBe('result');
    });

    it('should call cleanup on abort', async () => {
      const controller = new AbortController();
      let cleanupCalled = false;

      const promise = runWithAbort(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'result';
        },
        controller.signal,
        async () => { cleanupCalled = true; }
      );

      setTimeout(() => controller.abort('cancelled'), 10);

      await expect(promise).rejects.toThrow();
      expect(cleanupCalled).toBe(true);
    });
  });
});
