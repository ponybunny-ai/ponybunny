'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '@/lib/api-client';
import type {
  Goal,
  WorkItem,
  Escalation,
  Permission,
  GatewayEventType,
  ConversationState,
  ConversationMessageResult,
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

interface ConversationInfo {
  sessionId: string | null;
  personaId: string | null;
  state: ConversationState;
  activeGoalId: string | null;
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
  conversation: ConversationInfo;
  activeStreams: Map<string, StreamingResponse>;
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
  | { type: 'CLEAR_ERROR' }
  | { type: 'CONVERSATION_UPDATED'; sessionId: string; state: ConversationState; goalId?: string }
  | { type: 'CONVERSATION_ENDED' }
  | { type: 'LLM_STREAM_START'; data: any }
  | { type: 'LLM_STREAM_CHUNK'; data: any }
  | { type: 'LLM_STREAM_END'; data: any }
  | { type: 'LLM_STREAM_ERROR'; data: any };

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

    case 'CONVERSATION_UPDATED':
      return {
        ...state,
        conversation: {
          ...state.conversation,
          sessionId: action.sessionId,
          state: action.state,
          activeGoalId: action.goalId || state.conversation.activeGoalId,
        },
      };

    case 'CONVERSATION_ENDED':
      return {
        ...state,
        conversation: {
          sessionId: null,
          personaId: null,
          state: 'idle',
          activeGoalId: null,
        },
      };

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
  conversation: {
    sessionId: null,
    personaId: null,
    state: 'idle',
    activeGoalId: null,
  },
  activeStreams: new Map(),
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
  sendMessage: (message: string, personaId?: string) => Promise<ConversationMessageResult>;
  endConversation: () => Promise<void>;
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
      case 'llm.stream.start':
        dispatch({ type: 'LLM_STREAM_START', data });
        break;
      case 'llm.stream.chunk':
        dispatch({ type: 'LLM_STREAM_CHUNK', data });
        break;
      case 'llm.stream.end':
        dispatch({ type: 'LLM_STREAM_END', data });
        break;
      case 'llm.stream.error':
        dispatch({ type: 'LLM_STREAM_ERROR', data });
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

  const sendMessage = useCallback(async (message: string, personaId?: string): Promise<ConversationMessageResult> => {
    const result = await apiClient.sendMessage({
      sessionId: state.conversation.sessionId || undefined,
      personaId: personaId || state.conversation.personaId || undefined,
      message,
    });

    dispatch({
      type: 'CONVERSATION_UPDATED',
      sessionId: result.sessionId,
      state: result.state,
      goalId: result.taskInfo?.goalId,
    });

    // If a goal was created, add it to goals list
    if (result.taskInfo?.goalId) {
      dispatch({ type: 'SET_ACTIVE_GOAL', goalId: result.taskInfo.goalId });
    }

    return result;
  }, [state.conversation.sessionId, state.conversation.personaId]);

  const endConversation = useCallback(async () => {
    if (state.conversation.sessionId) {
      await apiClient.endConversation(state.conversation.sessionId);
    }
    dispatch({ type: 'CONVERSATION_ENDED' });
  }, [state.conversation.sessionId]);

  const value: GatewayContextValue = useMemo(() => ({
    state,
    submitGoal,
    setActiveGoal,
    refreshGoals,
    refreshWorkItems,
    respondToEscalation,
    sendMessage,
    endConversation,
  }), [state, submitGoal, setActiveGoal, refreshGoals, refreshWorkItems, respondToEscalation, sendMessage, endConversation]);

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
