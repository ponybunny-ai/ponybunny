'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  Goal,
  WorkItem,
  Escalation,
  Permission,
  GatewayEventType,
} from '@/lib/types';

// ============================================================================
// State Types
// ============================================================================

export interface GatewayEvent {
  id: string;
  type: GatewayEventType | string;
  timestamp: number;
  data: unknown;
}

interface GatewayState {
  connected: boolean;
  connecting: boolean;
  permissions: Permission[];
  goals: Goal[];
  activeGoalId: string | null;
  workItems: Map<string, WorkItem[]>;
  events: GatewayEvent[];
  escalations: Escalation[];
  error: string | null;
}

type GatewayAction =
  | { type: 'CONNECTING' }
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED'; error?: string }
  | { type: 'GOALS_LOADED'; goals: Goal[] }
  | { type: 'GOAL_CREATED'; goal: Goal }
  | { type: 'GOAL_UPDATED'; goal: Goal }
  | { type: 'SET_ACTIVE_GOAL'; goalId: string | null }
  | { type: 'WORKITEMS_LOADED'; goalId: string; workItems: WorkItem[] }
  | { type: 'WORKITEM_UPDATED'; workItem: WorkItem }
  | { type: 'EVENT_RECEIVED'; event: GatewayEvent }
  | { type: 'ESCALATION_CREATED'; escalation: Escalation }
  | { type: 'ESCALATION_UPDATED'; escalation: Escalation }
  | { type: 'ESCALATIONS_LOADED'; escalations: Escalation[] }
  | { type: 'CLEAR_ERROR' };

const MAX_EVENTS = 100;

function gatewayReducer(state: GatewayState, action: GatewayAction): GatewayState {
  switch (action.type) {
    case 'CONNECTING':
      return { ...state, connecting: true, error: null };

    case 'CONNECTED':
      return { ...state, connected: true, connecting: false, permissions: ['read', 'write', 'admin'] };

    case 'DISCONNECTED':
      return {
        ...state,
        connected: false,
        connecting: false,
        error: action.error || null,
      };

    case 'GOALS_LOADED':
      return { ...state, goals: action.goals };

    case 'GOAL_CREATED':
      return { ...state, goals: [action.goal, ...state.goals] };

    case 'GOAL_UPDATED': {
      const goals = state.goals.map((g) =>
        g.id === action.goal.id ? action.goal : g
      );
      return { ...state, goals };
    }

    case 'SET_ACTIVE_GOAL':
      return { ...state, activeGoalId: action.goalId };

    case 'WORKITEMS_LOADED': {
      const workItems = new Map(state.workItems);
      workItems.set(action.goalId, action.workItems);
      return { ...state, workItems };
    }

    case 'WORKITEM_UPDATED': {
      const workItems = new Map(state.workItems);
      const goalWorkItems = workItems.get(action.workItem.goal_id) || [];
      const updated = goalWorkItems.map((wi) =>
        wi.id === action.workItem.id ? action.workItem : wi
      );
      // Add if not exists
      if (!goalWorkItems.find((wi) => wi.id === action.workItem.id)) {
        updated.push(action.workItem);
      }
      workItems.set(action.workItem.goal_id, updated);
      return { ...state, workItems };
    }

    case 'EVENT_RECEIVED': {
      const events = [action.event, ...state.events].slice(0, MAX_EVENTS);
      return { ...state, events };
    }

    case 'ESCALATION_CREATED':
      return { ...state, escalations: [action.escalation, ...state.escalations] };

    case 'ESCALATION_UPDATED': {
      const escalations = state.escalations.map((e) =>
        e.id === action.escalation.id ? action.escalation : e
      );
      return { ...state, escalations };
    }

    case 'ESCALATIONS_LOADED':
      return { ...state, escalations: action.escalations };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}

const initialState: GatewayState = {
  connected: false,
  connecting: false,
  permissions: [],
  goals: [],
  activeGoalId: null,
  workItems: new Map(),
  events: [],
  escalations: [],
  error: null,
};

// ============================================================================
// Context
// ============================================================================

interface GatewayContextValue {
  state: GatewayState;
  submitGoal: (description: string, context?: Record<string, unknown>) => Promise<Goal>;
  setActiveGoal: (goalId: string | null) => void;
  refreshGoals: () => Promise<void>;
  refreshWorkItems: (goalId: string) => Promise<void>;
  respondToEscalation: (escalationId: string, action: string, data?: Record<string, unknown>) => Promise<void>;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface GatewayProviderProps {
  children: React.ReactNode;
}

export function GatewayProvider({ children }: GatewayProviderProps) {
  const [state, dispatch] = useReducer(gatewayReducer, initialState);

  // Handle incoming events
  const handleEvent = useCallback((eventType: string, data: unknown) => {
    const gatewayEvent: GatewayEvent = {
      id: crypto.randomUUID(),
      type: eventType as GatewayEventType,
      timestamp: Date.now(),
      data,
    };
    dispatch({ type: 'EVENT_RECEIVED', event: gatewayEvent });

    // Handle specific events
    switch (eventType) {
      case 'goal.created':
        dispatch({ type: 'GOAL_CREATED', goal: data as Goal });
        break;
      case 'goal.updated':
      case 'goal.completed':
      case 'goal.cancelled':
        dispatch({ type: 'GOAL_UPDATED', goal: data as Goal });
        break;
      case 'workitem.created':
      case 'workitem.updated':
      case 'workitem.completed':
      case 'workitem.failed':
        dispatch({ type: 'WORKITEM_UPDATED', workItem: data as WorkItem });
        break;
      case 'escalation.created':
        dispatch({ type: 'ESCALATION_CREATED', escalation: data as Escalation });
        break;
      case 'escalation.resolved':
        dispatch({ type: 'ESCALATION_UPDATED', escalation: data as Escalation });
        break;
    }
  }, []);

  // Connect to SSE on mount
  useEffect(() => {
    dispatch({ type: 'CONNECTING' });

    // Check gateway status first
    apiClient.getStatus()
      .then((status) => {
        if (status.connected) {
          dispatch({ type: 'CONNECTED' });
          // Connect to SSE for real-time events
          apiClient.connectEvents();
        } else {
          dispatch({ type: 'DISCONNECTED', error: status.error || 'Gateway not available' });
        }
      })
      .catch((error) => {
        dispatch({ type: 'DISCONNECTED', error: error.message });
      });

    // Subscribe to all events
    const unsubscribe = apiClient.on('*', (payload) => {
      const { event, data } = payload as { event: string; data: unknown };
      if (event !== 'heartbeat' && event !== 'connected') {
        handleEvent(event, data);
      }
    });

    return () => {
      unsubscribe();
      apiClient.disconnectEvents();
    };
  }, [handleEvent]);

  const submitGoal = useCallback(async (description: string, context?: Record<string, unknown>): Promise<Goal> => {
    const goal = await apiClient.submitGoal(description, context);
    dispatch({ type: 'GOAL_CREATED', goal });
    dispatch({ type: 'SET_ACTIVE_GOAL', goalId: goal.id });
    return goal;
  }, []);

  const setActiveGoal = useCallback((goalId: string | null) => {
    dispatch({ type: 'SET_ACTIVE_GOAL', goalId });
  }, []);

  const refreshGoals = useCallback(async () => {
    const { goals } = await apiClient.listGoals();
    dispatch({ type: 'GOALS_LOADED', goals });
  }, []);

  const refreshWorkItems = useCallback(async (goalId: string) => {
    const { workItems } = await apiClient.getWorkItems(goalId);
    dispatch({ type: 'WORKITEMS_LOADED', goalId, workItems });
  }, []);

  const respondToEscalation = useCallback(async (
    escalationId: string,
    action: string,
    data?: Record<string, unknown>
  ) => {
    await apiClient.respondToEscalation(escalationId, action, data);
  }, []);

  const value: GatewayContextValue = useMemo(() => ({
    state,
    submitGoal,
    setActiveGoal,
    refreshGoals,
    refreshWorkItems,
    respondToEscalation,
  }), [state, submitGoal, setActiveGoal, refreshGoals, refreshWorkItems, respondToEscalation]);

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useGateway(): GatewayContextValue {
  const context = useContext(GatewayContext);
  if (!context) {
    throw new Error('useGateway must be used within a GatewayProvider');
  }
  return context;
}
