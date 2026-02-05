/**
 * Debug Handlers - RPC handlers for debug/observability operations
 *
 * Provides real-time visibility into:
 * - Scheduler state and metrics
 * - Lane status (queued/active items per lane)
 * - Goal/WorkItem/Run hierarchy
 * - Event stream
 * - Gateway state
 */

import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { Goal, WorkItem, Run, Escalation, EscalationStatus } from '../../../work-order/types/index.js';
import type { RpcHandler } from '../rpc-handler.js';
import type { EventBus } from '../../events/event-bus.js';
import type { ISchedulerCore, GoalExecutionState, SchedulerMetrics } from '../../../scheduler/core/index.js';
import type { SchedulerState, LaneId, LaneStatus } from '../../../scheduler/types.js';
import type { ConnectionManager } from '../../connection/connection-manager.js';

// ============================================================================
// Extended Repository Interface
// ============================================================================

interface DebugRepository extends IWorkOrderRepository {
  listWorkItems?(filters?: { goalId?: string; status?: string }): WorkItem[];
  getAllWorkItemsForGoal?(goalId: string): WorkItem[];
  listEscalations?(filters?: { goalId?: string; status?: EscalationStatus }): Escalation[];
}

// ============================================================================
// Types
// ============================================================================

export interface DebugSnapshot {
  timestamp: number;
  scheduler: {
    state: SchedulerState;
    metrics: SchedulerMetrics;
    goalStates: GoalExecutionState[];
  } | null;
  gateway: {
    connections: {
      total: number;
      authenticated: number;
      pending: number;
    };
  };
  goals: {
    total: number;
    byStatus: Record<string, number>;
  };
  workItems: {
    total: number;
    byStatus: Record<string, number>;
  };
  recentEvents: DebugEvent[];
}

export interface DebugSchedulerState {
  status: string;
  activeGoals: string[];
  lanes: Record<LaneId, LaneStatus>;
  metrics: SchedulerMetrics;
  goalStates: GoalExecutionState[];
  lastTickAt?: number;
  errorCount: number;
}

export interface DebugLaneInfo {
  laneId: LaneId;
  status: LaneStatus;
  activeItems: Array<{
    workItemId: string;
    goalId: string;
    title: string;
    startedAt?: number;
  }>;
  queuedItems: Array<{
    workItemId: string;
    goalId: string;
    title: string;
  }>;
}

export interface DebugGoalTree {
  goal: Goal;
  executionState?: GoalExecutionState;
  workItems: Array<{
    workItem: WorkItem;
    runs: Run[];
  }>;
  escalations: Escalation[];
}

export interface DebugEvent {
  id: string;
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
}

export interface DebugGatewayState {
  connections: {
    total: number;
    authenticated: number;
    pending: number;
  };
  sessions: Array<{
    id: string;
    publicKey: string;
    permissions: string[];
    subscribedGoals: string[];
    connectedAt: number;
  }>;
}

// ============================================================================
// Event Store (in-memory ring buffer for recent events)
// ============================================================================

class EventStore {
  private events: DebugEvent[] = [];
  private maxEvents: number;
  private eventIdCounter = 0;

  constructor(maxEvents = 1000) {
    this.maxEvents = maxEvents;
  }

  add(type: string, data: Record<string, unknown>): void {
    const event: DebugEvent = {
      id: `evt_${++this.eventIdCounter}`,
      timestamp: Date.now(),
      type,
      data,
    };

    this.events.push(event);

    // Trim if over limit
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  getRecent(limit = 100, offset = 0): DebugEvent[] {
    const start = Math.max(0, this.events.length - limit - offset);
    const end = this.events.length - offset;
    return this.events.slice(start, end).reverse();
  }

  getByType(type: string, limit = 100): DebugEvent[] {
    return this.events
      .filter(e => e.type === type || e.type.startsWith(type + '.'))
      .slice(-limit)
      .reverse();
  }

  clear(): void {
    this.events = [];
  }
}

// Global event store instance
const eventStore = new EventStore();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all work items, using extended method if available, otherwise fallback
 */
function getAllWorkItems(repository: DebugRepository): WorkItem[] {
  if (repository.listWorkItems) {
    return repository.listWorkItems({});
  }
  // Fallback: get ready items (limited view)
  return repository.getReadyWorkItems();
}

/**
 * Get work items for a specific goal
 */
function getWorkItemsForGoal(repository: DebugRepository, goalId: string): WorkItem[] {
  if (repository.getAllWorkItemsForGoal) {
    return repository.getAllWorkItemsForGoal(goalId);
  }
  // Fallback: get ready items for goal
  return repository.getReadyWorkItems(goalId);
}

// ============================================================================
// Handler Registration
// ============================================================================

export function registerDebugHandlers(
  rpcHandler: RpcHandler,
  repository: DebugRepository,
  eventBus: EventBus,
  getScheduler: () => ISchedulerCore | null,
  getConnectionManager: () => ConnectionManager
): void {
  // Subscribe to all events for the event store
  eventBus.onAny((eventType: string, data: unknown) => {
    eventStore.add(eventType, (data as Record<string, unknown>) || {});
  });

  // ============================================================================
  // debug.snapshot - Full system state snapshot
  // ============================================================================
  rpcHandler.register<Record<string, never>, DebugSnapshot>(
    'debug.snapshot',
    ['admin'],
    async () => {
      const scheduler = getScheduler();
      const connectionManager = getConnectionManager();

      // Get goal stats
      const goals = repository.listGoals({});
      const goalsByStatus: Record<string, number> = {};
      for (const goal of goals) {
        goalsByStatus[goal.status] = (goalsByStatus[goal.status] || 0) + 1;
      }

      // Get work item stats
      const workItems = getAllWorkItems(repository);
      const workItemsByStatus: Record<string, number> = {};
      for (const wi of workItems) {
        workItemsByStatus[wi.status] = (workItemsByStatus[wi.status] || 0) + 1;
      }

      // Get connection stats
      const connStats = connectionManager.getStats();

      return {
        timestamp: Date.now(),
        scheduler: scheduler ? {
          state: scheduler.getState(),
          metrics: scheduler.getMetrics(),
          goalStates: scheduler.getAllGoalStates(),
        } : null,
        gateway: {
          connections: {
            total: connStats.totalSessions + connStats.pendingConnections,
            authenticated: connStats.totalSessions,
            pending: connStats.pendingConnections,
          },
        },
        goals: {
          total: goals.length,
          byStatus: goalsByStatus,
        },
        workItems: {
          total: workItems.length,
          byStatus: workItemsByStatus,
        },
        recentEvents: eventStore.getRecent(20),
      };
    }
  );

  // ============================================================================
  // debug.scheduler - Scheduler state details
  // ============================================================================
  rpcHandler.register<Record<string, never>, DebugSchedulerState | null>(
    'debug.scheduler',
    ['admin'],
    async () => {
      const scheduler = getScheduler();
      if (!scheduler) {
        return null;
      }

      const state = scheduler.getState();
      const metrics = scheduler.getMetrics();
      const goalStates = scheduler.getAllGoalStates();

      return {
        status: state.status,
        activeGoals: state.activeGoals,
        lanes: state.lanes,
        metrics,
        goalStates,
        lastTickAt: state.lastTickAt,
        errorCount: state.errorCount,
      };
    }
  );

  // ============================================================================
  // debug.lanes - Lane status with items
  // ============================================================================
  rpcHandler.register<Record<string, never>, { lanes: DebugLaneInfo[] }>(
    'debug.lanes',
    ['admin'],
    async () => {
      const scheduler = getScheduler();
      const lanes: DebugLaneInfo[] = [];

      const laneIds: LaneId[] = ['main', 'subagent', 'cron', 'session'];

      for (const laneId of laneIds) {
        const status: LaneStatus = scheduler
          ? scheduler.getState().lanes[laneId]
          : { laneId, activeCount: 0, queuedCount: 0, isAvailable: false };

        // Get work items in this lane (in_progress = active, ready = queued)
        const allWorkItems = getAllWorkItems(repository);

        // For now, we'll use a simple heuristic - in a real implementation,
        // the lane assignment would be tracked in the work item or run
        const activeItems: DebugLaneInfo['activeItems'] = [];
        const queuedItems: DebugLaneInfo['queuedItems'] = [];

        // Get goal states to find current work items
        if (scheduler) {
          const goalStates = scheduler.getAllGoalStates();
          for (const gs of goalStates) {
            if (gs.currentWorkItemId) {
              const wi = repository.getWorkItem(gs.currentWorkItemId);
              if (wi && wi.status === 'in_progress') {
                activeItems.push({
                  workItemId: wi.id,
                  goalId: wi.goal_id,
                  title: wi.title,
                  startedAt: wi.updated_at,
                });
              }
            }
          }
        }

        // Get queued/ready items
        for (const wi of allWorkItems) {
          if (wi.status === 'ready' || wi.status === 'queued') {
            queuedItems.push({
              workItemId: wi.id,
              goalId: wi.goal_id,
              title: wi.title,
            });
          }
        }

        lanes.push({
          laneId,
          status,
          activeItems: laneId === 'main' ? activeItems : [],
          queuedItems: laneId === 'main' ? queuedItems : [],
        });
      }

      return { lanes };
    }
  );

  // ============================================================================
  // debug.goals - All goals with status breakdown
  // ============================================================================
  rpcHandler.register<{ status?: string; limit?: number }, { goals: Goal[]; total: number }>(
    'debug.goals',
    ['admin'],
    async (params) => {
      const goals = repository.listGoals({
        status: params.status as Goal['status'] | undefined,
      });

      const limit = params.limit || 100;
      return {
        goals: goals.slice(0, limit),
        total: goals.length,
      };
    }
  );

  // ============================================================================
  // debug.goal - Single goal with full tree
  // ============================================================================
  rpcHandler.register<{ goalId: string }, DebugGoalTree | null>(
    'debug.goal',
    ['admin'],
    async (params) => {
      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        return null;
      }

      const scheduler = getScheduler();
      const executionState = scheduler?.getGoalState(params.goalId);

      // Get work items for this goal
      const workItems = getWorkItemsForGoal(repository, params.goalId);
      const workItemsWithRuns = workItems.map((wi: WorkItem) => ({
        workItem: wi,
        runs: repository.getRunsByWorkItem(wi.id),
      }));

      // Get escalations for this goal
      const allEscalations = repository.listEscalations?.({ goalId: params.goalId }) || [];

      return {
        goal,
        executionState,
        workItems: workItemsWithRuns,
        escalations: allEscalations,
      };
    }
  );

  // ============================================================================
  // debug.workitems - Work items with filters
  // ============================================================================
  rpcHandler.register<{ goalId?: string; status?: string; limit?: number }, { workItems: WorkItem[]; total: number }>(
    'debug.workitems',
    ['admin'],
    async (params) => {
      let workItems: WorkItem[];

      if (params.goalId) {
        workItems = getWorkItemsForGoal(repository, params.goalId);
      } else {
        workItems = getAllWorkItems(repository);
      }

      if (params.status) {
        workItems = workItems.filter((wi: WorkItem) => wi.status === params.status);
      }

      const limit = params.limit || 100;
      return {
        workItems: workItems.slice(0, limit),
        total: workItems.length,
      };
    }
  );

  // ============================================================================
  // debug.runs - Runs with filters
  // ============================================================================
  rpcHandler.register<{ workItemId?: string; status?: string; limit?: number }, { runs: Run[]; total: number }>(
    'debug.runs',
    ['admin'],
    async (params) => {
      let runs: Run[];

      if (params.workItemId) {
        runs = repository.getRunsByWorkItem(params.workItemId);
      } else {
        // Get all runs by iterating work items
        const workItems = getAllWorkItems(repository);
        runs = [];
        for (const wi of workItems) {
          runs.push(...repository.getRunsByWorkItem(wi.id));
        }
      }

      if (params.status) {
        runs = runs.filter((r: Run) => r.status === params.status);
      }

      // Sort by created_at descending
      runs.sort((a, b) => b.created_at - a.created_at);

      const limit = params.limit || 100;
      return {
        runs: runs.slice(0, limit),
        total: runs.length,
      };
    }
  );

  // ============================================================================
  // debug.events - Recent events
  // ============================================================================
  rpcHandler.register<{ limit?: number; offset?: number; type?: string }, { events: DebugEvent[]; total: number }>(
    'debug.events',
    ['admin'],
    async (params) => {
      const limit = params.limit || 100;
      const offset = params.offset || 0;

      let events: DebugEvent[];
      if (params.type) {
        events = eventStore.getByType(params.type, limit);
      } else {
        events = eventStore.getRecent(limit, offset);
      }

      return {
        events,
        total: events.length,
      };
    }
  );

  // ============================================================================
  // debug.events.subscribe - Subscribe to real-time event stream
  // ============================================================================
  rpcHandler.register<Record<string, never>, { success: boolean }>(
    'debug.events.subscribe',
    ['admin'],
    async (_params, session) => {
      // Subscribe to all events by subscribing to a special "debug" channel
      session.subscribeToDebugEvents();
      return { success: true };
    }
  );

  // ============================================================================
  // debug.events.unsubscribe - Unsubscribe from event stream
  // ============================================================================
  rpcHandler.register<Record<string, never>, { success: boolean }>(
    'debug.events.unsubscribe',
    ['admin'],
    async (_params, session) => {
      session.unsubscribeFromDebugEvents();
      return { success: true };
    }
  );

  // ============================================================================
  // debug.gateway - Gateway state
  // ============================================================================
  rpcHandler.register<Record<string, never>, DebugGatewayState>(
    'debug.gateway',
    ['admin'],
    async () => {
      const connectionManager = getConnectionManager();
      const stats = connectionManager.getStats();
      const sessions = connectionManager.getActiveSessions();

      return {
        connections: {
          total: stats.totalSessions + stats.pendingConnections,
          authenticated: stats.totalSessions,
          pending: stats.pendingConnections,
        },
        sessions,
      };
    }
  );
}
