/**
 * TUI State Reducer
 */

import type { AppState } from './types.js';
import type { AppAction } from './actions.js';
import { initialState } from './types.js';

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_DISPLAY_MODE':
      return { ...state, displayMode: action.payload };

    case 'ADD_SIMPLE_MESSAGE':
      return { ...state, simpleMessages: [...state.simpleMessages, action.payload] };

    case 'UPDATE_SIMPLE_MESSAGE':
      return {
        ...state,
        simpleMessages: state.simpleMessages.map(msg =>
          msg.id === action.payload.id ? { ...msg, ...action.payload.updates } : msg
        ),
      };

    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload };

    case 'SET_GATEWAY_URL':
      return { ...state, gatewayUrl: action.payload };

    case 'SET_CURRENT_VIEW':
      return { ...state, currentView: action.payload };

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

    case 'ADD_EVENT': {
      const newEvents = [...state.events, action.payload];
      // Keep only the last maxEvents
      if (newEvents.length > state.maxEvents) {
        return { ...state, events: newEvents.slice(-state.maxEvents) };
      }
      return { ...state, events: newEvents };
    }

    case 'CLEAR_EVENTS':
      return { ...state, events: [] };

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

    case 'RESET_STATE':
      return { ...initialState, gatewayUrl: state.gatewayUrl };

    default:
      return state;
  }
}
