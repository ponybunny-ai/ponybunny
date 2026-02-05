/**
 * useGoals - Hook for Goals state management
 */

import { useMemo } from 'react';
import { useAppContext } from '../context/app-context.js';
import type { Goal, GoalStatus } from '../../../work-order/types/index.js';

export interface UseGoalsResult {
  goals: Goal[];
  selectedGoal: Goal | null;
  selectedGoalId: string | null;
  isLoading: boolean;

  // Computed
  activeGoals: Goal[];
  completedGoals: Goal[];
  queuedGoals: Goal[];
  goalCount: number;
  activeCount: number;

  // Methods
  selectGoal: (goalId: string | null) => void;
  getGoalById: (goalId: string) => Goal | undefined;
  getGoalsByStatus: (status: GoalStatus) => Goal[];
}

export function useGoals(): UseGoalsResult {
  const { state, selectGoal } = useAppContext();
  const { goals, selectedGoalId, goalsLoading } = state;

  const selectedGoal = useMemo(() => {
    if (!selectedGoalId) return null;
    return goals.find(g => g.id === selectedGoalId) || null;
  }, [goals, selectedGoalId]);

  const activeGoals = useMemo(() => {
    return goals.filter(g => g.status === 'active');
  }, [goals]);

  const completedGoals = useMemo(() => {
    return goals.filter(g => g.status === 'completed');
  }, [goals]);

  const queuedGoals = useMemo(() => {
    return goals.filter(g => g.status === 'queued');
  }, [goals]);

  const getGoalById = useMemo(() => {
    return (goalId: string) => goals.find(g => g.id === goalId);
  }, [goals]);

  const getGoalsByStatus = useMemo(() => {
    return (status: GoalStatus) => goals.filter(g => g.status === status);
  }, [goals]);

  return {
    goals,
    selectedGoal,
    selectedGoalId,
    isLoading: goalsLoading,
    activeGoals,
    completedGoals,
    queuedGoals,
    goalCount: goals.length,
    activeCount: activeGoals.length,
    selectGoal,
    getGoalById,
    getGoalsByStatus,
  };
}
