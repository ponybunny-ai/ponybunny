/**
 * Debug TUI Types - State and data types for the debug TUI
 */

import type { Goal, WorkItem, Run } from '../../work-order/types/index.js';
import type { LaneId } from '../../scheduler/types.js';

// ============================================================================
// Debug Data Types (matching RPC responses)
// ============================================================================

export interface DebugSnapshot {
  timestamp: number;
  scheduler: {
    state: string;
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

export interface SchedulerMetrics {
  goalsStarted: number;
  goalsCompleted: number;
  goalsFailed: number;
  workItemsCompleted: number;
  workItemsFailed: number;
  totalTokensUsed: number;
  averageGoalDurationMs: number;
}

export interface GoalExecutionState {
  goalId: string;
  status: string;
  currentWorkItemId?: string;
  completedWorkItems: number;
  totalWorkItems: number;
  startedAt: number;
  error?: string;
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

export interface LaneStatus {
  laneId: LaneId;
  activeCount: number;
  queuedCount: number;
  isAvailable: boolean;
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
  escalations: unknown[];
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
// TUI State Types
// ============================================================================

export type DebugView = 'overview' | 'tasks' | 'lanes' | 'events' | 'inspect';

export interface InspectTarget {
  type: 'goal' | 'workitem' | 'run' | 'session';
  id: string;
}

export interface DebugTuiState {
  // Connection
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  errorMessage?: string;

  // Current view
  currentView: DebugView;

  // Data
  snapshot: DebugSnapshot | null;
  schedulerState: DebugSchedulerState | null;
  lanes: DebugLaneInfo[];
  goals: Goal[];
  events: DebugEvent[];
  gatewayState: DebugGatewayState | null;

  // Inspect view
  inspectTarget: InspectTarget | null;
  inspectData: DebugGoalTree | WorkItem | Run | null;

  // UI state
  selectedIndex: number;
  expandedGoals: Set<string>;
  eventsPaused: boolean;
  eventsFilter: string;

  // Refresh
  lastRefresh: number;
  isRefreshing: boolean;
}

export const initialDebugState: DebugTuiState = {
  connectionStatus: 'connecting',
  currentView: 'overview',
  snapshot: null,
  schedulerState: null,
  lanes: [],
  goals: [],
  events: [],
  gatewayState: null,
  inspectTarget: null,
  inspectData: null,
  selectedIndex: 0,
  expandedGoals: new Set(),
  eventsPaused: false,
  eventsFilter: '',
  lastRefresh: 0,
  isRefreshing: false,
};

// ============================================================================
// Actions
// ============================================================================

export type DebugAction =
  | { type: 'SET_CONNECTION_STATUS'; status: DebugTuiState['connectionStatus']; error?: string }
  | { type: 'SET_VIEW'; view: DebugView }
  | { type: 'SET_SNAPSHOT'; snapshot: DebugSnapshot }
  | { type: 'SET_SCHEDULER_STATE'; state: DebugSchedulerState | null }
  | { type: 'SET_LANES'; lanes: DebugLaneInfo[] }
  | { type: 'SET_GOALS'; goals: Goal[] }
  | { type: 'ADD_EVENT'; event: DebugEvent }
  | { type: 'SET_EVENTS'; events: DebugEvent[] }
  | { type: 'SET_GATEWAY_STATE'; state: DebugGatewayState }
  | { type: 'SET_INSPECT_TARGET'; target: InspectTarget | null }
  | { type: 'SET_INSPECT_DATA'; data: DebugGoalTree | WorkItem | Run | null }
  | { type: 'SET_SELECTED_INDEX'; index: number }
  | { type: 'TOGGLE_GOAL_EXPANDED'; goalId: string }
  | { type: 'TOGGLE_EVENTS_PAUSED' }
  | { type: 'SET_EVENTS_FILTER'; filter: string }
  | { type: 'SET_REFRESHING'; isRefreshing: boolean }
  | { type: 'CLEAR_EVENTS' };

export function debugReducer(state: DebugTuiState, action: DebugAction): DebugTuiState {
  switch (action.type) {
    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.status, errorMessage: action.error };

    case 'SET_VIEW':
      return { ...state, currentView: action.view, selectedIndex: 0 };

    case 'SET_SNAPSHOT':
      return { ...state, snapshot: action.snapshot, lastRefresh: Date.now() };

    case 'SET_SCHEDULER_STATE':
      return { ...state, schedulerState: action.state };

    case 'SET_LANES':
      return { ...state, lanes: action.lanes };

    case 'SET_GOALS':
      return { ...state, goals: action.goals };

    case 'ADD_EVENT':
      if (state.eventsPaused) {
        return state;
      }
      return {
        ...state,
        events: [action.event, ...state.events].slice(0, 500),
      };

    case 'SET_EVENTS':
      return { ...state, events: action.events };

    case 'SET_GATEWAY_STATE':
      return { ...state, gatewayState: action.state };

    case 'SET_INSPECT_TARGET':
      return { ...state, inspectTarget: action.target, currentView: action.target ? 'inspect' : state.currentView };

    case 'SET_INSPECT_DATA':
      return { ...state, inspectData: action.data };

    case 'SET_SELECTED_INDEX':
      return { ...state, selectedIndex: action.index };

    case 'TOGGLE_GOAL_EXPANDED': {
      const expanded = new Set(state.expandedGoals);
      if (expanded.has(action.goalId)) {
        expanded.delete(action.goalId);
      } else {
        expanded.add(action.goalId);
      }
      return { ...state, expandedGoals: expanded };
    }

    case 'TOGGLE_EVENTS_PAUSED':
      return { ...state, eventsPaused: !state.eventsPaused };

    case 'SET_EVENTS_FILTER':
      return { ...state, eventsFilter: action.filter };

    case 'SET_REFRESHING':
      return { ...state, isRefreshing: action.isRefreshing };

    case 'CLEAR_EVENTS':
      return { ...state, events: [] };

    default:
      return state;
  }
}
