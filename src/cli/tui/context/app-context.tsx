/**
 * App Context - Global application state management
 */

import * as React from 'react';
import { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { appReducer } from '../store/reducer.js';
import { actions, type AppAction } from '../store/actions.js';
import { initialState, type AppState, type ViewType, type ModalType, type SimpleMessage } from '../store/types.js';
import type { Goal, WorkItem, Escalation } from '../../../work-order/types/index.js';

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;

  addSimpleMessage: (message: SimpleMessage) => void;
  updateSimpleMessage: (id: string, updates: Partial<Omit<SimpleMessage, 'id'>>) => void;

  // Convenience methods
  setView: (view: ViewType) => void;
  openModal: (modal: ModalType, data?: unknown) => void;
  closeModal: () => void;
  setActivityStatus: (status: string) => void;
  addEvent: (event: string, data: unknown) => void;
  clearEvents: () => void;

  // Goal methods
  setGoals: (goals: Goal[]) => void;
  addGoal: (goal: Goal) => void;
  updateGoal: (goal: Goal) => void;
  removeGoal: (goalId: string) => void;
  selectGoal: (goalId: string | null) => void;

  // Work item methods
  setWorkItems: (workItems: WorkItem[]) => void;
  updateWorkItem: (workItem: WorkItem) => void;

  // Escalation methods
  setEscalations: (escalations: Escalation[]) => void;
  addEscalation: (escalation: Escalation) => void;
  removeEscalation: (escalationId: string) => void;

  // Input methods
  setInputValue: (value: string) => void;
  addToInputHistory: (value: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export interface AppProviderProps {
  children: React.ReactNode;
  initialUrl?: string;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children, initialUrl }) => {
  const [state, dispatch] = useReducer(appReducer, {
    ...initialState,
    gatewayUrl: initialUrl || initialState.gatewayUrl,
  });

  const addSimpleMessage = useCallback((message: SimpleMessage) => {
    dispatch(actions.addSimpleMessage(message));
  }, []);

  const updateSimpleMessage = useCallback((id: string, updates: Partial<Omit<SimpleMessage, 'id'>>) => {
    dispatch(actions.updateSimpleMessage(id, updates));
  }, []);

  // View methods
  const setView = useCallback((view: ViewType) => {
    dispatch(actions.setCurrentView(view));
  }, []);

  // Modal methods
  const openModal = useCallback((modal: ModalType, data?: unknown) => {
    dispatch(actions.openModal(modal, data));
  }, []);

  const closeModal = useCallback(() => {
    dispatch(actions.closeModal());
  }, []);

  // Activity methods
  const setActivityStatus = useCallback((status: string) => {
    dispatch(actions.setActivityStatus(status));
  }, []);

  // Event methods
  const addEvent = useCallback((event: string, data: unknown) => {
    dispatch(actions.addEvent({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      event,
      data,
      timestamp: Date.now(),
    }));
  }, []);

  const clearEvents = useCallback(() => {
    dispatch(actions.clearEvents());
  }, []);

  // Goal methods
  const setGoals = useCallback((goals: Goal[]) => {
    dispatch(actions.setGoals(goals));
  }, []);

  const addGoal = useCallback((goal: Goal) => {
    dispatch(actions.addGoal(goal));
  }, []);

  const updateGoal = useCallback((goal: Goal) => {
    dispatch(actions.updateGoal(goal));
  }, []);

  const removeGoal = useCallback((goalId: string) => {
    dispatch(actions.removeGoal(goalId));
  }, []);

  const selectGoal = useCallback((goalId: string | null) => {
    dispatch(actions.setSelectedGoalId(goalId));
  }, []);

  // Work item methods
  const setWorkItems = useCallback((workItems: WorkItem[]) => {
    dispatch(actions.setWorkItems(workItems));
  }, []);

  const updateWorkItem = useCallback((workItem: WorkItem) => {
    dispatch(actions.updateWorkItem(workItem));
  }, []);

  // Escalation methods
  const setEscalations = useCallback((escalations: Escalation[]) => {
    dispatch(actions.setEscalations(escalations));
  }, []);

  const addEscalation = useCallback((escalation: Escalation) => {
    dispatch(actions.addEscalation(escalation));
  }, []);

  const removeEscalation = useCallback((escalationId: string) => {
    dispatch(actions.removeEscalation(escalationId));
  }, []);

  // Input methods
  const setInputValue = useCallback((value: string) => {
    dispatch(actions.setInputValue(value));
  }, []);

  const addToInputHistory = useCallback((value: string) => {
    dispatch(actions.addToInputHistory(value));
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    state,
    dispatch,
    addSimpleMessage,
    updateSimpleMessage,
    setView,
    openModal,
    closeModal,
    setActivityStatus,
    addEvent,
    clearEvents,
    setGoals,
    addGoal,
    updateGoal,
    removeGoal,
    selectGoal,
    setWorkItems,
    updateWorkItem,
    setEscalations,
    addEscalation,
    removeEscalation,
    setInputValue,
    addToInputHistory,
  }), [
    state,
    addSimpleMessage,
    updateSimpleMessage,
    setView,
    openModal,
    closeModal,
    setActivityStatus,
    addEvent,
    clearEvents,
    setGoals,
    addGoal,
    updateGoal,
    removeGoal,
    selectGoal,
    setWorkItems,
    updateWorkItem,
    setEscalations,
    addEscalation,
    removeEscalation,
    setInputValue,
    addToInputHistory,
  ]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
