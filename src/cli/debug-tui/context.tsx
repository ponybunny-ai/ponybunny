/**
 * Debug TUI Context - State management for the debug TUI
 */

import * as React from 'react';
import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import { GatewayClient } from '../gateway/gateway-client.js';
import {
  type DebugTuiState,
  type DebugAction,
  type DebugView,
  type DebugSnapshot,
  type DebugSchedulerState,
  type DebugLaneInfo,
  type DebugEvent,
  type DebugGatewayState,
  type DebugGoalTree,
  type InspectTarget,
  initialDebugState,
  debugReducer,
} from './types.js';
import type { Goal, WorkItem, Run } from '../../work-order/types/index.js';

// ============================================================================
// Context Types
// ============================================================================

interface DebugContextValue {
  state: DebugTuiState;
  client: GatewayClient | null;

  // Actions
  setView: (view: DebugView) => void;
  refresh: () => Promise<void>;
  inspect: (target: InspectTarget | null) => Promise<void>;
  toggleGoalExpanded: (goalId: string) => void;
  toggleEventsPaused: () => void;
  setEventsFilter: (filter: string) => void;
  clearEvents: () => void;
  setSelectedIndex: (index: number) => void;
  subscribeToDebugEvents: () => Promise<void>;
  unsubscribeFromDebugEvents: () => Promise<void>;
}

const DebugContext = createContext<DebugContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface DebugProviderProps {
  url?: string;
  token?: string;
  children: React.ReactNode;
}

export const DebugProvider: React.FC<DebugProviderProps> = ({ url, token, children }) => {
  const [state, dispatch] = useReducer(debugReducer, initialDebugState);
  const clientRef = useRef<GatewayClient | null>(null);

  // Initialize client
  useEffect(() => {
    const client = new GatewayClient({ url, token });
    clientRef.current = client;

    client.onConnected = () => {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'connected' });
    };

    client.onDisconnected = (reason) => {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'disconnected', error: reason });
    };

    client.onEvent = (eventType, data) => {
      // Add to event stream
      const event: DebugEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type: eventType,
        data: (data as Record<string, unknown>) || {},
      };
      dispatch({ type: 'ADD_EVENT', event });
    };

    client.onError = (error) => {
      dispatch({ type: 'SET_CONNECTION_STATUS', status: 'error', error: error.message });
    };

    client.start();

    return () => {
      client.stop();
    };
  }, [url, token]);

  // Refresh all data
  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !client.isConnected()) return;

    dispatch({ type: 'SET_REFRESHING', isRefreshing: true });

    try {
      // Fetch snapshot
      const snapshot = await client.request<DebugSnapshot>('debug.snapshot');
      dispatch({ type: 'SET_SNAPSHOT', snapshot });

      // Fetch scheduler state
      const schedulerState = await client.request<DebugSchedulerState | null>('debug.scheduler');
      dispatch({ type: 'SET_SCHEDULER_STATE', state: schedulerState });

      // Fetch lanes
      const lanesResult = await client.request<{ lanes: DebugLaneInfo[] }>('debug.lanes');
      dispatch({ type: 'SET_LANES', lanes: lanesResult.lanes });

      // Fetch goals
      const goalsResult = await client.request<{ goals: Goal[] }>('debug.goals');
      dispatch({ type: 'SET_GOALS', goals: goalsResult.goals });

      // Fetch gateway state
      const gatewayState = await client.request<DebugGatewayState>('debug.gateway');
      dispatch({ type: 'SET_GATEWAY_STATE', state: gatewayState });

      // Fetch recent events
      const eventsResult = await client.request<{ events: DebugEvent[] }>('debug.events', { limit: 100 });
      dispatch({ type: 'SET_EVENTS', events: eventsResult.events });
    } catch (error) {
      // Silently handle refresh errors
    } finally {
      dispatch({ type: 'SET_REFRESHING', isRefreshing: false });
    }
  }, []);

  // Set view
  const setView = useCallback((view: DebugView) => {
    dispatch({ type: 'SET_VIEW', view });
  }, []);

  // Inspect entity
  const inspect = useCallback(async (target: InspectTarget | null) => {
    dispatch({ type: 'SET_INSPECT_TARGET', target });

    if (!target) {
      dispatch({ type: 'SET_INSPECT_DATA', data: null });
      return;
    }

    const client = clientRef.current;
    if (!client || !client.isConnected()) return;

    try {
      switch (target.type) {
        case 'goal': {
          const data = await client.request<DebugGoalTree>('debug.goal', { goalId: target.id });
          dispatch({ type: 'SET_INSPECT_DATA', data });
          break;
        }
        case 'workitem': {
          const result = await client.request<{ workItems: WorkItem[] }>('debug.workitems', { limit: 1000 });
          const workItem = result.workItems.find(wi => wi.id === target.id);
          dispatch({ type: 'SET_INSPECT_DATA', data: workItem || null });
          break;
        }
        case 'run': {
          const result = await client.request<{ runs: Run[] }>('debug.runs', { limit: 1000 });
          const run = result.runs.find(r => r.id === target.id);
          dispatch({ type: 'SET_INSPECT_DATA', data: run || null });
          break;
        }
      }
    } catch (error) {
      dispatch({ type: 'SET_INSPECT_DATA', data: null });
    }
  }, []);

  // Toggle goal expanded
  const toggleGoalExpanded = useCallback((goalId: string) => {
    dispatch({ type: 'TOGGLE_GOAL_EXPANDED', goalId });
  }, []);

  // Toggle events paused
  const toggleEventsPaused = useCallback(() => {
    dispatch({ type: 'TOGGLE_EVENTS_PAUSED' });
  }, []);

  // Set events filter
  const setEventsFilter = useCallback((filter: string) => {
    dispatch({ type: 'SET_EVENTS_FILTER', filter });
  }, []);

  // Clear events
  const clearEvents = useCallback(() => {
    dispatch({ type: 'CLEAR_EVENTS' });
  }, []);

  // Set selected index
  const setSelectedIndex = useCallback((index: number) => {
    dispatch({ type: 'SET_SELECTED_INDEX', index });
  }, []);

  // Subscribe to debug events
  const subscribeToDebugEvents = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !client.isConnected()) return;

    try {
      await client.request('debug.events.subscribe');
    } catch (error) {
      // Silently handle subscription errors
    }
  }, []);

  // Unsubscribe from debug events
  const unsubscribeFromDebugEvents = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !client.isConnected()) return;

    try {
      await client.request('debug.events.unsubscribe');
    } catch (error) {
      // Silently handle unsubscription errors
    }
  }, []);

  const value: DebugContextValue = {
    state,
    client: clientRef.current,
    setView,
    refresh,
    inspect,
    toggleGoalExpanded,
    toggleEventsPaused,
    setEventsFilter,
    clearEvents,
    setSelectedIndex,
    subscribeToDebugEvents,
    unsubscribeFromDebugEvents,
  };

  return React.createElement(DebugContext.Provider, { value }, children);
};

// ============================================================================
// Hook
// ============================================================================

export function useDebugContext(): DebugContextValue {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error('useDebugContext must be used within a DebugProvider');
  }
  return context;
}
