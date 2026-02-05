/**
 * Scheduler Bridge Tests
 */

import { SchedulerBridge } from '../../../src/gateway/integration/scheduler-bridge.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import type { ISchedulerCore } from '../../../src/scheduler/core/index.js';
import type { SchedulerEvent, SchedulerEventHandler } from '../../../src/scheduler/types.js';

describe('SchedulerBridge', () => {
  let bridge: SchedulerBridge;
  let mockEventBus: EventBus;
  let mockScheduler: ISchedulerCore;
  let capturedHandler: SchedulerEventHandler | null = null;

  beforeEach(() => {
    // Create mock event bus
    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    // Create mock scheduler
    mockScheduler = {
      on: jest.fn((handler: SchedulerEventHandler) => {
        capturedHandler = handler;
      }),
      off: jest.fn(),
      getState: jest.fn(),
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      submitGoal: jest.fn(),
      cancelGoal: jest.fn(),
      getGoalState: jest.fn(),
      getAllGoalStates: jest.fn(),
      getMetrics: jest.fn(),
      tick: jest.fn(),
    } as unknown as ISchedulerCore;

    bridge = new SchedulerBridge(mockEventBus);
    capturedHandler = null;
  });

  describe('connect', () => {
    it('should connect to scheduler and subscribe to events', () => {
      bridge.connect(mockScheduler);

      expect(mockScheduler.on).toHaveBeenCalledTimes(1);
      expect(bridge.isConnected()).toBe(true);
    });

    it('should warn if already connected', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      bridge.connect(mockScheduler);
      bridge.connect(mockScheduler);

      expect(warnSpy).toHaveBeenCalledWith('[SchedulerBridge] Already connected to a scheduler');
      warnSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('should disconnect from scheduler', () => {
      bridge.connect(mockScheduler);
      bridge.disconnect();

      expect(mockScheduler.off).toHaveBeenCalledTimes(1);
      expect(bridge.isConnected()).toBe(false);
    });

    it('should do nothing if not connected', () => {
      bridge.disconnect();
      expect(mockScheduler.off).not.toHaveBeenCalled();
    });
  });

  describe('event translation', () => {
    beforeEach(() => {
      bridge.connect(mockScheduler);
    });

    it('should translate goal_started event', () => {
      const event: SchedulerEvent = {
        type: 'goal_started',
        timestamp: Date.now(),
        goalId: 'goal-1',
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('goal.started', {
        goalId: 'goal-1',
        timestamp: event.timestamp,
      });
    });

    it('should translate goal_completed event', () => {
      const event: SchedulerEvent = {
        type: 'goal_completed',
        timestamp: Date.now(),
        goalId: 'goal-1',
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('goal.completed', {
        goalId: 'goal-1',
        timestamp: event.timestamp,
      });
    });

    it('should translate goal_failed event', () => {
      const event: SchedulerEvent = {
        type: 'goal_failed',
        timestamp: Date.now(),
        goalId: 'goal-1',
        data: { error: { code: 'ERR', message: 'Failed' } },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('goal.failed', {
        goalId: 'goal-1',
        error: { code: 'ERR', message: 'Failed' },
        timestamp: event.timestamp,
      });
    });

    it('should translate work_item_started event', () => {
      const event: SchedulerEvent = {
        type: 'work_item_started',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        runId: 'run-1',
        data: { model: 'gpt-4', laneId: 'main' },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('workitem.started', {
        workItemId: 'wi-1',
        goalId: 'goal-1',
        runId: 'run-1',
        model: 'gpt-4',
        laneId: 'main',
        timestamp: event.timestamp,
      });
    });

    it('should translate work_item_completed event', () => {
      const event: SchedulerEvent = {
        type: 'work_item_completed',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('workitem.completed', {
        workItemId: 'wi-1',
        goalId: 'goal-1',
        timestamp: event.timestamp,
      });
    });

    it('should translate work_item_failed event', () => {
      const event: SchedulerEvent = {
        type: 'work_item_failed',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        data: { error: 'Something went wrong' },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('workitem.failed', {
        workItemId: 'wi-1',
        goalId: 'goal-1',
        error: 'Something went wrong',
        timestamp: event.timestamp,
      });
    });

    it('should translate run_started event', () => {
      const event: SchedulerEvent = {
        type: 'run_started',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        runId: 'run-1',
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('run.started', {
        runId: 'run-1',
        workItemId: 'wi-1',
        goalId: 'goal-1',
        timestamp: event.timestamp,
      });
    });

    it('should translate run_completed event', () => {
      const event: SchedulerEvent = {
        type: 'run_completed',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        runId: 'run-1',
        data: { success: true },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('run.completed', {
        runId: 'run-1',
        workItemId: 'wi-1',
        goalId: 'goal-1',
        success: true,
        timestamp: event.timestamp,
      });
    });

    it('should translate verification_started event', () => {
      const event: SchedulerEvent = {
        type: 'verification_started',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        runId: 'run-1',
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('verification.started', {
        workItemId: 'wi-1',
        goalId: 'goal-1',
        runId: 'run-1',
        timestamp: event.timestamp,
      });
    });

    it('should translate verification_completed event', () => {
      const event: SchedulerEvent = {
        type: 'verification_completed',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        runId: 'run-1',
        data: { passed: true, summary: 'All tests passed' },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('verification.completed', {
        workItemId: 'wi-1',
        goalId: 'goal-1',
        runId: 'run-1',
        passed: true,
        summary: 'All tests passed',
        timestamp: event.timestamp,
      });
    });

    it('should translate escalation_created event', () => {
      const event: SchedulerEvent = {
        type: 'escalation_created',
        timestamp: Date.now(),
        goalId: 'goal-1',
        workItemId: 'wi-1',
        data: { type: 'error_recovery', error: 'Max retries exceeded' },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('escalation.created', {
        workItemId: 'wi-1',
        goalId: 'goal-1',
        type: 'error_recovery',
        error: 'Max retries exceeded',
        timestamp: event.timestamp,
      });
    });

    it('should translate budget_warning event', () => {
      const event: SchedulerEvent = {
        type: 'budget_warning',
        timestamp: Date.now(),
        goalId: 'goal-1',
        data: { level: 'warning', status: { percentUsed: 80 } },
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('budget.warning', {
        goalId: 'goal-1',
        level: 'warning',
        status: { percentUsed: 80 },
        timestamp: event.timestamp,
      });
    });

    it('should translate budget_exceeded event', () => {
      const event: SchedulerEvent = {
        type: 'budget_exceeded',
        timestamp: Date.now(),
        goalId: 'goal-1',
      };

      capturedHandler!(event);

      expect(mockEventBus.emit).toHaveBeenCalledWith('budget.exceeded', {
        goalId: 'goal-1',
        timestamp: event.timestamp,
      });
    });
  });

  describe('emit', () => {
    it('should manually emit events to event bus', () => {
      bridge.emit('custom.event', { data: 'test' });

      expect(mockEventBus.emit).toHaveBeenCalledWith('custom.event', { data: 'test' });
    });
  });
});
