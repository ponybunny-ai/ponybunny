/**
 * useGateway - Hook for Gateway operations
 */

import { useCallback, useRef, useEffect } from 'react';
import { useGatewayContext } from '../context/gateway-context.js';
import { useAppContext } from '../context/app-context.js';
import { actions } from '../store/actions.js';
import type { Goal, WorkItem, Escalation } from '../../../work-order/types/index.js';
import type { GoalSubmitParams } from '../../gateway/tui-gateway-client.js';

export interface UseGatewayResult {
  // Connection
  isConnected: boolean;
  connectionStatus: string;
  url: string;

  // System methods
  ping: () => Promise<{ pong: number } | null>;
  getStats: () => Promise<unknown>;

  // Goal methods
  submitGoal: (params: GoalSubmitParams) => Promise<Goal | null>;
  getGoalStatus: (goalId: string) => Promise<Goal | null>;
  cancelGoal: (goalId: string, reason?: string) => Promise<boolean>;
  listGoals: () => Promise<Goal[]>;

  // Work item methods
  listWorkItems: (goalId?: string) => Promise<WorkItem[]>;
  getWorkItem: (workItemId: string) => Promise<WorkItem | null>;

  // Escalation methods
  listEscalations: () => Promise<Escalation[]>;
  resolveEscalation: (escalationId: string, resolution: unknown) => Promise<boolean>;

  // Approval methods
  listApprovals: () => Promise<unknown[]>;
  approve: (approvalId: string) => Promise<boolean>;
  reject: (approvalId: string, reason?: string) => Promise<boolean>;

  // Refresh methods
  refreshGoals: () => Promise<void>;
  refreshWorkItems: (goalId?: string) => Promise<void>;
  refreshEscalations: () => Promise<void>;
}

export function useGateway(): UseGatewayResult {
  const { client, connectionStatus, url } = useGatewayContext();
  const { dispatch, setActivityStatus, addEvent } = useAppContext();
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const isConnected = connectionStatus === 'connected';

  // System methods
  const ping = useCallback(async () => {
    if (!client || !isConnected) return null;
    try {
      setActivityStatus('pinging...');
      const result = await client.ping();
      if (isMounted.current) setActivityStatus('idle');
      return result;
    } catch (error) {
      if (isMounted.current) setActivityStatus('idle');
      return null;
    }
  }, [client, isConnected, setActivityStatus]);

  const getStats = useCallback(async () => {
    if (!client || !isConnected) return null;
    try {
      return await client.getStats();
    } catch {
      return null;
    }
  }, [client, isConnected]);

  // Goal methods
  const submitGoal = useCallback(async (params: GoalSubmitParams) => {
    if (!client || !isConnected) return null;
    try {
      setActivityStatus('creating goal...');
      const goal = await client.submitGoal(params);
      if (isMounted.current) {
        dispatch(actions.addGoal(goal));
        addEvent('goal.created', { goalId: goal.id, title: goal.title });
        setActivityStatus('idle');
      }
      return goal;
    } catch (error) {
      if (isMounted.current) setActivityStatus('idle');
      throw error;
    }
  }, [client, isConnected, dispatch, setActivityStatus, addEvent]);

  const getGoalStatus = useCallback(async (goalId: string) => {
    if (!client || !isConnected) return null;
    try {
      return await client.getGoalStatus(goalId);
    } catch {
      return null;
    }
  }, [client, isConnected]);

  const cancelGoal = useCallback(async (goalId: string, reason?: string) => {
    if (!client || !isConnected) return false;
    try {
      setActivityStatus('cancelling goal...');
      await client.cancelGoal(goalId, reason);
      if (isMounted.current) {
        dispatch(actions.removeGoal(goalId));
        addEvent('goal.cancelled', { goalId, reason });
        setActivityStatus('idle');
      }
      return true;
    } catch {
      if (isMounted.current) setActivityStatus('idle');
      return false;
    }
  }, [client, isConnected, dispatch, setActivityStatus, addEvent]);

  const listGoals = useCallback(async () => {
    if (!client || !isConnected) return [];
    try {
      const result = await client.listGoals();
      return result.goals;
    } catch {
      return [];
    }
  }, [client, isConnected]);

  // Work item methods
  const listWorkItems = useCallback(async (goalId?: string) => {
    if (!client || !isConnected) return [];
    try {
      const result = await client.listWorkItems(goalId ? { goalId } : undefined);
      return result.workItems;
    } catch {
      return [];
    }
  }, [client, isConnected]);

  const getWorkItem = useCallback(async (workItemId: string) => {
    if (!client || !isConnected) return null;
    try {
      return await client.getWorkItem(workItemId);
    } catch {
      return null;
    }
  }, [client, isConnected]);

  // Escalation methods
  const listEscalations = useCallback(async () => {
    if (!client || !isConnected) return [];
    try {
      const result = await client.listEscalations();
      return (result.escalations || []) as Escalation[];
    } catch {
      return [];
    }
  }, [client, isConnected]);

  const resolveEscalation = useCallback(async (escalationId: string, resolution: unknown) => {
    if (!client || !isConnected) return false;
    try {
      setActivityStatus('resolving escalation...');
      await client.resolveEscalation(escalationId, resolution);
      if (isMounted.current) {
        dispatch(actions.removeEscalation(escalationId));
        addEvent('escalation.resolved', { escalationId });
        setActivityStatus('idle');
      }
      return true;
    } catch {
      if (isMounted.current) setActivityStatus('idle');
      return false;
    }
  }, [client, isConnected, dispatch, setActivityStatus, addEvent]);

  // Approval methods
  const listApprovals = useCallback(async () => {
    if (!client || !isConnected) return [];
    try {
      const result = await client.listApprovals();
      return result.approvals || [];
    } catch {
      return [];
    }
  }, [client, isConnected]);

  const approve = useCallback(async (approvalId: string) => {
    if (!client || !isConnected) return false;
    try {
      setActivityStatus('approving...');
      await client.approve(approvalId);
      if (isMounted.current) {
        addEvent('approval.approved', { approvalId });
        setActivityStatus('idle');
      }
      return true;
    } catch {
      if (isMounted.current) setActivityStatus('idle');
      return false;
    }
  }, [client, isConnected, setActivityStatus, addEvent]);

  const reject = useCallback(async (approvalId: string, reason?: string) => {
    if (!client || !isConnected) return false;
    try {
      setActivityStatus('rejecting...');
      await client.reject(approvalId, reason);
      if (isMounted.current) {
        addEvent('approval.rejected', { approvalId, reason });
        setActivityStatus('idle');
      }
      return true;
    } catch {
      if (isMounted.current) setActivityStatus('idle');
      return false;
    }
  }, [client, isConnected, setActivityStatus, addEvent]);

  // Refresh methods
  const refreshGoals = useCallback(async () => {
    if (!client || !isConnected) return;
    try {
      dispatch(actions.setGoalsLoading(true));
      const goals = await listGoals();
      if (isMounted.current) {
        dispatch(actions.setGoals(goals));
        dispatch(actions.setGoalsLoading(false));
      }
    } catch {
      if (isMounted.current) dispatch(actions.setGoalsLoading(false));
    }
  }, [client, isConnected, dispatch, listGoals]);

  const refreshWorkItems = useCallback(async (goalId?: string) => {
    if (!client || !isConnected) return;
    try {
      dispatch(actions.setWorkItemsLoading(true));
      const workItems = await listWorkItems(goalId);
      if (isMounted.current) {
        dispatch(actions.setWorkItems(workItems));
        dispatch(actions.setWorkItemsLoading(false));
      }
    } catch {
      if (isMounted.current) dispatch(actions.setWorkItemsLoading(false));
    }
  }, [client, isConnected, dispatch, listWorkItems]);

  const refreshEscalations = useCallback(async () => {
    if (!client || !isConnected) return;
    try {
      dispatch(actions.setEscalationsLoading(true));
      const escalations = await listEscalations();
      if (isMounted.current) {
        dispatch(actions.setEscalations(escalations));
        dispatch(actions.setEscalationsLoading(false));
      }
    } catch {
      if (isMounted.current) dispatch(actions.setEscalationsLoading(false));
    }
  }, [client, isConnected, dispatch, listEscalations]);

  return {
    isConnected,
    connectionStatus,
    url,
    ping,
    getStats,
    submitGoal,
    getGoalStatus,
    cancelGoal,
    listGoals,
    listWorkItems,
    getWorkItem,
    listEscalations,
    resolveEscalation,
    listApprovals,
    approve,
    reject,
    refreshGoals,
    refreshWorkItems,
    refreshEscalations,
  };
}
