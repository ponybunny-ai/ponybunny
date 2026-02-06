'use client';

import { useCallback, useEffect } from 'react';
import { useGateway } from '@/components/providers/gateway-provider';
import type { Goal } from '@/lib/types';

export function useGoals() {
  const { state, submitGoal, setActiveGoal, refreshGoals, refreshWorkItems } = useGateway();

  const activeGoal = state.goals.find((g) => g.id === state.activeGoalId) || null;
  const activeWorkItems = state.activeGoalId
    ? state.workItems.get(state.activeGoalId) || []
    : [];

  // Refresh work items when active goal changes
  useEffect(() => {
    if (state.activeGoalId && state.connected) {
      refreshWorkItems(state.activeGoalId);
    }
  }, [state.activeGoalId, state.connected, refreshWorkItems]);

  // Load goals on initial connection
  useEffect(() => {
    if (state.connected) {
      refreshGoals();
    }
  }, [state.connected, refreshGoals]);

  const submit = useCallback(async (description: string, context?: Record<string, unknown>): Promise<Goal> => {
    return submitGoal(description, context);
  }, [submitGoal]);

  return {
    goals: state.goals,
    activeGoal,
    activeGoalId: state.activeGoalId,
    activeWorkItems,
    setActiveGoal,
    submitGoal: submit,
    refreshGoals,
    refreshWorkItems,
  };
}
