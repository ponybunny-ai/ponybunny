/**
 * TUI State Reducer
 */

import type { AppState } from './types.js';
import type { AppAction } from './actions.js';
import { initialState } from './types.js';

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_SIMPLE_MESSAGE':
      return { ...state, simpleMessages: [...state.simpleMessages, action.payload] };

    case 'UPDATE_SIMPLE_MESSAGE':
      return {
        ...state,
        simpleMessages: state.simpleMessages.map(msg =>
          msg.id === action.payload.id ? { ...msg, ...action.payload.updates } : msg
        ),
      };

    case 'REMOVE_SIMPLE_MESSAGE':
      return {
        ...state,
        simpleMessages: state.simpleMessages.filter(msg => msg.id !== action.payload),
      };

    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };

    case 'SET_GATEWAY_URL':
      return { ...state, gatewayUrl: action.payload };

    case 'SET_CURRENT_VIEW':
      return { ...state, currentView: action.payload };

    case 'SET_ACTIVE_SESSION':
      return {
        ...state,
        activeSessionId: action.payload.sessionId,
        activeSessionTitle: Object.prototype.hasOwnProperty.call(action.payload, 'title')
          ? (action.payload.title ?? null)
          : state.activeSessionTitle,
      };

    case 'SET_SESSIONS':
      return {
        ...state,
        sessions: action.payload,
      };

    case 'SET_SESSIONS_VIEW_STATE':
      return {
        ...state,
        sessionsLifecycleFilter: action.payload.lifecycleFilter ?? state.sessionsLifecycleFilter,
        sessionsSearchQuery: action.payload.searchQuery ?? state.sessionsSearchQuery,
        sessionsSortMode: action.payload.sortMode ?? state.sessionsSortMode,
      };

    case 'SET_SESSION_HISTORY_PREVIEW':
      return {
        ...state,
        sessionHistoryPreviews: {
          ...state.sessionHistoryPreviews,
          [action.payload.sessionId]: action.payload,
        },
      };

    case 'CLEAR_SESSION_HISTORY_PREVIEW': {
      if (!state.sessionHistoryPreviews[action.payload]) {
        return state;
      }
      const next = { ...state.sessionHistoryPreviews };
      delete next[action.payload];
      return {
        ...state,
        sessionHistoryPreviews: next,
      };
    }

    case 'CLEAR_ALL_SESSION_HISTORY_PREVIEWS':
      return {
        ...state,
        sessionHistoryPreviews: {},
      };

    case 'SET_EVENTS_VIEW_STATE':
      return {
        ...state,
        eventsFilter: action.payload.filter ?? state.eventsFilter,
        eventsSearchQuery: action.payload.searchQuery ?? state.eventsSearchQuery,
      };

    case 'SET_GOALS':
      return { ...state, goals: action.payload };

    case 'ADD_GOAL':
      // Don't add if goal with same ID already exists
      if (state.goals.some(g => g.id === action.payload.id)) {
        return state;
      }
      return { ...state, goals: [...state.goals, action.payload] };

    case 'UPDATE_GOAL':
      return {
        ...state,
        goals: state.goals.map(g =>
          g.id === action.payload.id ? action.payload : g
        ),
      };

    case 'REMOVE_GOAL':
      return {
        ...state,
        goals: state.goals.filter(g => g.id !== action.payload),
        selectedGoalId: state.selectedGoalId === action.payload ? null : state.selectedGoalId,
      };

    case 'SET_SELECTED_GOAL_ID':
      if (state.selectedGoalId === action.payload) {
        return state;
      }
      return { ...state, selectedGoalId: action.payload };

    case 'SET_GOALS_LOADING':
      return { ...state, goalsLoading: action.payload };

    case 'SET_WORK_ITEMS':
      return { ...state, workItems: action.payload };

    case 'UPDATE_WORK_ITEM':
      return {
        ...state,
        workItems: state.workItems.map(wi =>
          wi.id === action.payload.id ? action.payload : wi
        ),
      };

    case 'SET_WORK_ITEMS_LOADING':
      return { ...state, workItemsLoading: action.payload };

    case 'SET_ESCALATIONS':
      return {
        ...state,
        escalations: action.payload,
        pendingEscalationCount: action.payload.filter(e => e.status === 'open').length,
      };

    case 'ADD_ESCALATION':
      return {
        ...state,
        escalations: [...state.escalations, action.payload],
        pendingEscalationCount: state.pendingEscalationCount + (action.payload.status === 'open' ? 1 : 0),
      };

    case 'REMOVE_ESCALATION':
      const removedEscalation = state.escalations.find(e => e.id === action.payload);
      return {
        ...state,
        escalations: state.escalations.filter(e => e.id !== action.payload),
        pendingEscalationCount: removedEscalation?.status === 'open'
          ? state.pendingEscalationCount - 1
          : state.pendingEscalationCount,
      };

    case 'SET_ESCALATIONS_LOADING':
      return { ...state, escalationsLoading: action.payload };

    case 'SET_PENDING_ESCALATION_COUNT':
      return { ...state, pendingEscalationCount: action.payload };

    case 'SET_PENDING_APPROVAL_COUNT':
      return { ...state, pendingApprovalCount: action.payload };

    case 'SET_SCHEDULER_CAPABILITIES':
      return { ...state, schedulerCapabilities: action.payload };

    case 'SET_SELECTED_MODEL':
      return { ...state, selectedModel: action.payload };

    case 'ADD_EVENT': {
      const newEvents = [...state.events, action.payload];
      // Keep only the last maxEvents
      if (newEvents.length > state.maxEvents) {
        return { ...state, events: newEvents.slice(-state.maxEvents) };
      }
      return { ...state, events: newEvents };
    }

    case 'ADD_EVENTS': {
      if (action.payload.length === 0) {
        return state;
      }

      const newEvents = [...state.events, ...action.payload];
      if (newEvents.length > state.maxEvents) {
        return { ...state, events: newEvents.slice(-state.maxEvents) };
      }

      return { ...state, events: newEvents };
    }

    case 'CLEAR_EVENTS':
      return { ...state, events: [], eventsSearchQuery: '' };

    case 'ADD_RUNTIME_SNAPSHOT': {
      const maxSnapshots = 20;
      const runtimeSnapshots = [...state.runtimeSnapshots, action.payload].slice(-maxSnapshots);
      return { ...state, runtimeSnapshots };
    }

    case 'SET_RUNTIME_TUI_CONFIG':
      return { ...state, runtimeTuiConfig: action.payload };

    case 'SET_ACTIVITY_STATUS':
      return { ...state, activityStatus: action.payload };

    case 'OPEN_MODAL':
      return {
        ...state,
        activeModal: action.payload.modal,
        modalData: action.payload.data,
      };

    case 'CLOSE_MODAL':
      return { ...state, activeModal: null, modalData: null };

    case 'SET_INPUT_VALUE':
      return { ...state, inputValue: action.payload };

    case 'ADD_TO_INPUT_HISTORY': {
      // Don't add duplicates of the last entry
      if (state.inputHistory[state.inputHistory.length - 1] === action.payload) {
        return { ...state, inputHistoryIndex: -1 };
      }
      const newHistory = [...state.inputHistory, action.payload].slice(-50); // Keep last 50
      return { ...state, inputHistory: newHistory, inputHistoryIndex: -1 };
    }

    case 'SET_INPUT_HISTORY_INDEX':
      return { ...state, inputHistoryIndex: action.payload };

    case 'SET_INPUT_FOCUSED':
      return { ...state, inputFocused: action.payload };

    case 'RESET_STATE':
      return { ...initialState, gatewayUrl: state.gatewayUrl };

    default:
      return state;
  }
}
