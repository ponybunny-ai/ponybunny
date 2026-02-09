'use client';

import * as React from 'react';
import { debugApiClient } from '@/lib/api-client';
import type {
  DebugEvent,
  CachedGoal,
  CachedWorkItem,
  CachedRun,
  AggregatedMetrics,
  EventFilter,
  HealthStatus,
} from '@/lib/types';

interface DebugState {
  connected: boolean;
  gatewayConnected: boolean;
  events: DebugEvent[];
  goals: Map<string, CachedGoal>;
  workItems: Map<string, CachedWorkItem[]>;
  runs: Map<string, CachedRun[]>;
  metrics: AggregatedMetrics | null;
  selectedGoalId: string | null;
  eventFilter: EventFilter;
  health: HealthStatus | null;
  activeStreams: Map<string, StreamingResponse>;
}

interface StreamingResponse {
  requestId: string;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  model: string;
  chunks: string[];
  startTime: number;
  endTime?: number;
  status: 'streaming' | 'completed' | 'error';
  tokensUsed?: number;
  finishReason?: string;
}

type DebugAction =
  | { type: 'WS_CONNECTED' }
  | { type: 'WS_DISCONNECTED' }
  | { type: 'HEALTH_UPDATE'; health: HealthStatus }
  | { type: 'EVENT_RECEIVED'; event: DebugEvent }
  | { type: 'EVENTS_LOADED'; events: DebugEvent[] }
  | { type: 'GOALS_LOADED'; goals: CachedGoal[] }
  | { type: 'GOAL_SELECTED'; goalId: string | null }
  | { type: 'GOAL_DETAIL_LOADED'; goal: CachedGoal; workItems: CachedWorkItem[]; events: DebugEvent[] }
  | { type: 'WORKITEMS_LOADED'; goalId: string; workItems: CachedWorkItem[] }
  | { type: 'METRICS_LOADED'; metrics: AggregatedMetrics }
  | { type: 'FILTER_CHANGED'; filter: EventFilter }
  | { type: 'CLEAR_EVENTS' }
  | { type: 'LLM_STREAM_START'; data: any }
  | { type: 'LLM_STREAM_CHUNK'; data: any }
  | { type: 'LLM_STREAM_END'; data: any }
  | { type: 'LLM_STREAM_ERROR'; data: any };

const initialState: DebugState = {
  connected: false,
  gatewayConnected: false,
  events: [],
  goals: new Map(),
  workItems: new Map(),
  runs: new Map(),
  metrics: null,
  selectedGoalId: null,
  eventFilter: { limit: 100 },
  health: null,
  activeStreams: new Map(),
};

function debugReducer(state: DebugState, action: DebugAction): DebugState {
  switch (action.type) {
    case 'WS_CONNECTED':
      return { ...state, connected: true };
    case 'WS_DISCONNECTED':
      return { ...state, connected: false };
    case 'HEALTH_UPDATE':
      return {
        ...state,
        health: action.health,
        gatewayConnected: action.health.gatewayConnected,
      };
    case 'EVENT_RECEIVED':
      return {
        ...state,
        events: [action.event, ...state.events].slice(0, 1000), // Keep last 1000
      };
    case 'EVENTS_LOADED':
      return { ...state, events: action.events };
    case 'GOALS_LOADED': {
      const goals = new Map(state.goals);
      action.goals.forEach((goal) => goals.set(goal.id, goal));
      return { ...state, goals };
    }
    case 'GOAL_SELECTED':
      return { ...state, selectedGoalId: action.goalId };
    case 'GOAL_DETAIL_LOADED': {
      const goals = new Map(state.goals);
      goals.set(action.goal.id, action.goal);
      const workItems = new Map(state.workItems);
      workItems.set(action.goal.id, action.workItems);
      return { ...state, goals, workItems };
    }
    case 'WORKITEMS_LOADED': {
      const workItems = new Map(state.workItems);
      workItems.set(action.goalId, action.workItems);
      return { ...state, workItems };
    }
    case 'METRICS_LOADED':
      return { ...state, metrics: action.metrics };
    case 'FILTER_CHANGED':
      return { ...state, eventFilter: action.filter };
    case 'CLEAR_EVENTS':
      return { ...state, events: [] };
    case 'LLM_STREAM_START': {
      const activeStreams = new Map(state.activeStreams);
      activeStreams.set(action.data.requestId, {
        requestId: action.data.requestId,
        goalId: action.data.goalId,
        workItemId: action.data.workItemId,
        runId: action.data.runId,
        model: action.data.model,
        chunks: [],
        startTime: action.data.timestamp,
        status: 'streaming',
      });
      return { ...state, activeStreams };
    }
    case 'LLM_STREAM_CHUNK': {
      const activeStreams = new Map(state.activeStreams);
      const stream = activeStreams.get(action.data.requestId);
      if (stream) {
        stream.chunks.push(action.data.chunk);
        activeStreams.set(action.data.requestId, { ...stream });
      }
      return { ...state, activeStreams };
    }
    case 'LLM_STREAM_END': {
      const activeStreams = new Map(state.activeStreams);
      const stream = activeStreams.get(action.data.requestId);
      if (stream) {
        stream.status = 'completed';
        stream.endTime = action.data.timestamp;
        stream.tokensUsed = action.data.tokensUsed;
        stream.finishReason = action.data.finishReason;
        activeStreams.set(action.data.requestId, { ...stream });
      }
      return { ...state, activeStreams };
    }
    case 'LLM_STREAM_ERROR': {
      const activeStreams = new Map(state.activeStreams);
      const stream = activeStreams.get(action.data.requestId);
      if (stream) {
        stream.status = 'error';
        stream.endTime = action.data.timestamp;
        activeStreams.set(action.data.requestId, { ...stream });
      }
      return { ...state, activeStreams };
    }
    default:
      return state;
  }
}

interface DebugContextValue {
  state: DebugState;
  dispatch: React.Dispatch<DebugAction>;
  loadHealth: () => Promise<void>;
  loadEvents: (filter?: EventFilter) => Promise<void>;
  loadGoals: () => Promise<void>;
  loadGoal: (id: string) => Promise<void>;
  loadMetrics: () => Promise<void>;
  selectGoal: (id: string | null) => void;
  setFilter: (filter: EventFilter) => void;
}

const DebugContext = React.createContext<DebugContextValue | null>(null);

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(debugReducer, initialState);

  // WebSocket connection
  React.useEffect(() => {
    debugApiClient.connectWebSocket();

    const unsubConnected = debugApiClient.on('connected', () => {
      dispatch({ type: 'WS_CONNECTED' });
    });

    const unsubDisconnected = debugApiClient.on('disconnected', () => {
      dispatch({ type: 'WS_DISCONNECTED' });
    });

    const unsubEvent = debugApiClient.on('event', (data) => {
      dispatch({ type: 'EVENT_RECEIVED', event: data as DebugEvent });
    });

    const unsubStatus = debugApiClient.on('status', (data) => {
      const status = data as { gatewayConnected: boolean; eventCount: number };
      dispatch({
        type: 'HEALTH_UPDATE',
        health: {
          status: 'ok',
          gatewayConnected: status.gatewayConnected,
          eventCount: status.eventCount,
        },
      });
    });

    const unsubStreamStart = debugApiClient.on('llm.stream.start', (data) => {
      dispatch({ type: 'LLM_STREAM_START', data });
    });

    const unsubStreamChunk = debugApiClient.on('llm.stream.chunk', (data) => {
      dispatch({ type: 'LLM_STREAM_CHUNK', data });
    });

    const unsubStreamEnd = debugApiClient.on('llm.stream.end', (data) => {
      dispatch({ type: 'LLM_STREAM_END', data });
    });

    const unsubStreamError = debugApiClient.on('llm.stream.error', (data) => {
      dispatch({ type: 'LLM_STREAM_ERROR', data });
    });

    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubEvent();
      unsubStatus();
      unsubStreamStart();
      unsubStreamChunk();
      unsubStreamEnd();
      unsubStreamError();
      debugApiClient.disconnectWebSocket();
    };
  }, []);

  // API methods
  const loadHealth = React.useCallback(async () => {
    try {
      const health = await debugApiClient.getHealth();
      dispatch({ type: 'HEALTH_UPDATE', health });
    } catch (error) {
      console.error('Failed to load health:', error);
    }
  }, []);

  const loadEvents = React.useCallback(async (filter?: EventFilter) => {
    try {
      const { events } = await debugApiClient.getEvents(filter || state.eventFilter);
      dispatch({ type: 'EVENTS_LOADED', events });
    } catch (error) {
      console.error('Failed to load events:', error);
    }
  }, [state.eventFilter]);

  const loadGoals = React.useCallback(async () => {
    try {
      const { goals } = await debugApiClient.getGoals();
      dispatch({ type: 'GOALS_LOADED', goals });
    } catch (error) {
      console.error('Failed to load goals:', error);
    }
  }, []);

  const loadGoal = React.useCallback(async (id: string) => {
    try {
      const { goal, workItems, events } = await debugApiClient.getGoal(id);
      dispatch({ type: 'GOAL_DETAIL_LOADED', goal, workItems, events });
    } catch (error) {
      console.error('Failed to load goal:', error);
    }
  }, []);

  const loadMetrics = React.useCallback(async () => {
    try {
      const { current } = await debugApiClient.getMetrics();
      dispatch({ type: 'METRICS_LOADED', metrics: current });
    } catch (error) {
      console.error('Failed to load metrics:', error);
    }
  }, []);

  const selectGoal = React.useCallback((id: string | null) => {
    dispatch({ type: 'GOAL_SELECTED', goalId: id });
  }, []);

  const setFilter = React.useCallback((filter: EventFilter) => {
    dispatch({ type: 'FILTER_CHANGED', filter });
  }, []);

  const value: DebugContextValue = {
    state,
    dispatch,
    loadHealth,
    loadEvents,
    loadGoals,
    loadGoal,
    loadMetrics,
    selectGoal,
    setFilter,
  };

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>;
}

export function useDebug(): DebugContextValue {
  const context = React.useContext(DebugContext);
  if (!context) {
    throw new Error('useDebug must be used within DebugProvider');
  }
  return context;
}
