/**
 * TUI State Actions
 */

import type { Goal, WorkItem, Escalation } from '../../../work-order/types/index.js';
import type { ConnectionStatus, ViewType, ModalType, GatewayEvent, DisplayMode, SimpleMessage } from './types.js';

// Display mode actions
export interface SetDisplayModeAction {
  type: 'SET_DISPLAY_MODE';
  payload: DisplayMode;
}

// Simple message actions
export interface AddSimpleMessageAction {
  type: 'ADD_SIMPLE_MESSAGE';
  payload: SimpleMessage;
}

export interface UpdateSimpleMessageAction {
  type: 'UPDATE_SIMPLE_MESSAGE';
  payload: {
    id: string;
    updates: Partial<Omit<SimpleMessage, 'id'>>;
  };
}

// Connection actions
export interface SetConnectionStatusAction {
  type: 'SET_CONNECTION_STATUS';
  payload: ConnectionStatus;
}

export interface SetGatewayUrlAction {
  type: 'SET_GATEWAY_URL';
  payload: string;
}

// View actions
export interface SetCurrentViewAction {
  type: 'SET_CURRENT_VIEW';
  payload: ViewType;
}

// Goals actions
export interface SetGoalsAction {
  type: 'SET_GOALS';
  payload: Goal[];
}

export interface AddGoalAction {
  type: 'ADD_GOAL';
  payload: Goal;
}

export interface UpdateGoalAction {
  type: 'UPDATE_GOAL';
  payload: Goal;
}

export interface RemoveGoalAction {
  type: 'REMOVE_GOAL';
  payload: string; // goalId
}

export interface SetSelectedGoalIdAction {
  type: 'SET_SELECTED_GOAL_ID';
  payload: string | null;
}

export interface SetGoalsLoadingAction {
  type: 'SET_GOALS_LOADING';
  payload: boolean;
}

// Work Items actions
export interface SetWorkItemsAction {
  type: 'SET_WORK_ITEMS';
  payload: WorkItem[];
}

export interface UpdateWorkItemAction {
  type: 'UPDATE_WORK_ITEM';
  payload: WorkItem;
}

export interface SetWorkItemsLoadingAction {
  type: 'SET_WORK_ITEMS_LOADING';
  payload: boolean;
}

// Escalations actions
export interface SetEscalationsAction {
  type: 'SET_ESCALATIONS';
  payload: Escalation[];
}

export interface AddEscalationAction {
  type: 'ADD_ESCALATION';
  payload: Escalation;
}

export interface RemoveEscalationAction {
  type: 'REMOVE_ESCALATION';
  payload: string; // escalationId
}

export interface SetEscalationsLoadingAction {
  type: 'SET_ESCALATIONS_LOADING';
  payload: boolean;
}

export interface SetPendingEscalationCountAction {
  type: 'SET_PENDING_ESCALATION_COUNT';
  payload: number;
}

// Approvals actions
export interface SetPendingApprovalCountAction {
  type: 'SET_PENDING_APPROVAL_COUNT';
  payload: number;
}

// Events actions
export interface AddEventAction {
  type: 'ADD_EVENT';
  payload: GatewayEvent;
}

export interface ClearEventsAction {
  type: 'CLEAR_EVENTS';
}

// Activity actions
export interface SetActivityStatusAction {
  type: 'SET_ACTIVITY_STATUS';
  payload: string;
}

// Modal actions
export interface OpenModalAction {
  type: 'OPEN_MODAL';
  payload: {
    modal: ModalType;
    data?: unknown;
  };
}

export interface CloseModalAction {
  type: 'CLOSE_MODAL';
}

// Input actions
export interface SetInputValueAction {
  type: 'SET_INPUT_VALUE';
  payload: string;
}

export interface AddToInputHistoryAction {
  type: 'ADD_TO_INPUT_HISTORY';
  payload: string;
}

export interface SetInputHistoryIndexAction {
  type: 'SET_INPUT_HISTORY_INDEX';
  payload: number;
}

// Reset action
export interface ResetStateAction {
  type: 'RESET_STATE';
}

export type AppAction =
  | SetDisplayModeAction
  | AddSimpleMessageAction
  | UpdateSimpleMessageAction
  | SetConnectionStatusAction
  | SetGatewayUrlAction
  | SetCurrentViewAction
  | SetGoalsAction
  | AddGoalAction
  | UpdateGoalAction
  | RemoveGoalAction
  | SetSelectedGoalIdAction
  | SetGoalsLoadingAction
  | SetWorkItemsAction
  | UpdateWorkItemAction
  | SetWorkItemsLoadingAction
  | SetEscalationsAction
  | AddEscalationAction
  | RemoveEscalationAction
  | SetEscalationsLoadingAction
  | SetPendingEscalationCountAction
  | SetPendingApprovalCountAction
  | AddEventAction
  | ClearEventsAction
  | SetActivityStatusAction
  | OpenModalAction
  | CloseModalAction
  | SetInputValueAction
  | AddToInputHistoryAction
  | SetInputHistoryIndexAction
  | ResetStateAction;

// Action creators
export const actions = {
  setDisplayMode: (mode: DisplayMode): SetDisplayModeAction => ({
    type: 'SET_DISPLAY_MODE',
    payload: mode,
  }),

  addSimpleMessage: (message: SimpleMessage): AddSimpleMessageAction => ({
    type: 'ADD_SIMPLE_MESSAGE',
    payload: message,
  }),

  updateSimpleMessage: (id: string, updates: Partial<Omit<SimpleMessage, 'id'>>): UpdateSimpleMessageAction => ({
    type: 'UPDATE_SIMPLE_MESSAGE',
    payload: { id, updates },
  }),

  setConnectionStatus: (status: ConnectionStatus): SetConnectionStatusAction => ({
    type: 'SET_CONNECTION_STATUS',
    payload: status,
  }),

  setGatewayUrl: (url: string): SetGatewayUrlAction => ({
    type: 'SET_GATEWAY_URL',
    payload: url,
  }),

  setCurrentView: (view: ViewType): SetCurrentViewAction => ({
    type: 'SET_CURRENT_VIEW',
    payload: view,
  }),

  setGoals: (goals: Goal[]): SetGoalsAction => ({
    type: 'SET_GOALS',
    payload: goals,
  }),

  addGoal: (goal: Goal): AddGoalAction => ({
    type: 'ADD_GOAL',
    payload: goal,
  }),

  updateGoal: (goal: Goal): UpdateGoalAction => ({
    type: 'UPDATE_GOAL',
    payload: goal,
  }),

  removeGoal: (goalId: string): RemoveGoalAction => ({
    type: 'REMOVE_GOAL',
    payload: goalId,
  }),

  setSelectedGoalId: (goalId: string | null): SetSelectedGoalIdAction => ({
    type: 'SET_SELECTED_GOAL_ID',
    payload: goalId,
  }),

  setGoalsLoading: (loading: boolean): SetGoalsLoadingAction => ({
    type: 'SET_GOALS_LOADING',
    payload: loading,
  }),

  setWorkItems: (workItems: WorkItem[]): SetWorkItemsAction => ({
    type: 'SET_WORK_ITEMS',
    payload: workItems,
  }),

  updateWorkItem: (workItem: WorkItem): UpdateWorkItemAction => ({
    type: 'UPDATE_WORK_ITEM',
    payload: workItem,
  }),

  setWorkItemsLoading: (loading: boolean): SetWorkItemsLoadingAction => ({
    type: 'SET_WORK_ITEMS_LOADING',
    payload: loading,
  }),

  setEscalations: (escalations: Escalation[]): SetEscalationsAction => ({
    type: 'SET_ESCALATIONS',
    payload: escalations,
  }),

  addEscalation: (escalation: Escalation): AddEscalationAction => ({
    type: 'ADD_ESCALATION',
    payload: escalation,
  }),

  removeEscalation: (escalationId: string): RemoveEscalationAction => ({
    type: 'REMOVE_ESCALATION',
    payload: escalationId,
  }),

  setEscalationsLoading: (loading: boolean): SetEscalationsLoadingAction => ({
    type: 'SET_ESCALATIONS_LOADING',
    payload: loading,
  }),

  setPendingEscalationCount: (count: number): SetPendingEscalationCountAction => ({
    type: 'SET_PENDING_ESCALATION_COUNT',
    payload: count,
  }),

  setPendingApprovalCount: (count: number): SetPendingApprovalCountAction => ({
    type: 'SET_PENDING_APPROVAL_COUNT',
    payload: count,
  }),

  addEvent: (event: GatewayEvent): AddEventAction => ({
    type: 'ADD_EVENT',
    payload: event,
  }),

  clearEvents: (): ClearEventsAction => ({
    type: 'CLEAR_EVENTS',
  }),

  setActivityStatus: (status: string): SetActivityStatusAction => ({
    type: 'SET_ACTIVITY_STATUS',
    payload: status,
  }),

  openModal: (modal: ModalType, data?: unknown): OpenModalAction => ({
    type: 'OPEN_MODAL',
    payload: { modal, data },
  }),

  closeModal: (): CloseModalAction => ({
    type: 'CLOSE_MODAL',
  }),

  setInputValue: (value: string): SetInputValueAction => ({
    type: 'SET_INPUT_VALUE',
    payload: value,
  }),

  addToInputHistory: (value: string): AddToInputHistoryAction => ({
    type: 'ADD_TO_INPUT_HISTORY',
    payload: value,
  }),

  setInputHistoryIndex: (index: number): SetInputHistoryIndexAction => ({
    type: 'SET_INPUT_HISTORY_INDEX',
    payload: index,
  }),

  resetState: (): ResetStateAction => ({
    type: 'RESET_STATE',
  }),
};
