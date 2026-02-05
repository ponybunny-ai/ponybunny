/**
 * TUI Gateway Client - High-level client for TUI operations
 */

import { GatewayClient, type GatewayClientOptions } from './gateway-client.js';
import type { Goal, GoalStatus, WorkItem } from '../../work-order/types/index.js';

export interface TuiGatewayClientOptions extends GatewayClientOptions {
  // Additional TUI-specific options can be added here
}

export interface GoalSubmitParams {
  title: string;
  description: string;
  success_criteria: Goal['success_criteria'];
  priority?: number;
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
}

export interface GoalListParams {
  status?: GoalStatus;
  limit?: number;
  offset?: number;
}

export interface WorkItemListParams {
  goalId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface GatewayStatus {
  isRunning: boolean;
  address: string | null;
  connections: {
    total: number;
    authenticated: number;
  };
  daemonConnected: boolean;
  schedulerConnected: boolean;
}

export interface GatewayEvent {
  event: string;
  data: unknown;
}

export class TuiGatewayClient {
  private client: GatewayClient;

  // Event callbacks
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onEvent?: (evt: GatewayEvent) => void;
  onError?: (error: Error) => void;

  readonly url: string;

  constructor(options: TuiGatewayClientOptions = {}) {
    this.client = new GatewayClient(options);
    this.url = this.client.url;

    // Wire up callbacks
    this.client.onConnected = () => this.onConnected?.();
    this.client.onDisconnected = (reason) => this.onDisconnected?.(reason);
    this.client.onEvent = (event, data) => this.onEvent?.({ event, data });
    this.client.onError = (error) => this.onError?.(error);
  }

  /**
   * Start the client
   */
  start(): void {
    this.client.start();
  }

  /**
   * Stop the client
   */
  stop(): void {
    this.client.stop();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client.isConnected();
  }

  // ============================================================================
  // System Methods
  // ============================================================================

  /**
   * Ping the gateway
   */
  async ping(): Promise<{ pong: number }> {
    return this.client.request('system.ping');
  }

  /**
   * Get available methods
   */
  async getMethods(): Promise<{ methods: string[] }> {
    return this.client.request('system.methods');
  }

  /**
   * Get gateway stats
   */
  async getStats(): Promise<GatewayStatus> {
    return this.client.request('system.stats');
  }

  // ============================================================================
  // Goal Methods
  // ============================================================================

  /**
   * Submit a new goal
   */
  async submitGoal(params: GoalSubmitParams): Promise<Goal> {
    return this.client.request('goal.submit', params);
  }

  /**
   * Get goal status
   */
  async getGoalStatus(goalId: string): Promise<Goal> {
    return this.client.request('goal.status', { goalId });
  }

  /**
   * Cancel a goal
   */
  async cancelGoal(goalId: string, reason?: string): Promise<{ success: boolean }> {
    return this.client.request('goal.cancel', { goalId, reason });
  }

  /**
   * List goals
   */
  async listGoals(params?: GoalListParams): Promise<{ goals: Goal[]; total: number }> {
    return this.client.request('goal.list', params || {});
  }

  /**
   * Subscribe to goal events
   */
  async subscribeToGoal(goalId: string): Promise<{ success: boolean }> {
    return this.client.request('goal.subscribe', { goalId });
  }

  /**
   * Unsubscribe from goal events
   */
  async unsubscribeFromGoal(goalId: string): Promise<{ success: boolean }> {
    return this.client.request('goal.unsubscribe', { goalId });
  }

  // ============================================================================
  // WorkItem Methods
  // ============================================================================

  /**
   * Get a work item
   */
  async getWorkItem(workItemId: string): Promise<WorkItem> {
    return this.client.request('workitem.get', { workItemId });
  }

  /**
   * List work items
   */
  async listWorkItems(params?: WorkItemListParams): Promise<{ workItems: WorkItem[]; total: number }> {
    return this.client.request('workitem.list', params || {});
  }

  /**
   * Get work items for a goal
   */
  async getWorkItemsByGoal(goalId: string): Promise<{ workItems: WorkItem[] }> {
    return this.client.request('workitem.byGoal', { goalId });
  }

  /**
   * Get runs for a work item
   */
  async getWorkItemRuns(workItemId: string): Promise<{ runs: unknown[] }> {
    return this.client.request('workitem.runs', { workItemId });
  }

  // ============================================================================
  // Escalation Methods
  // ============================================================================

  /**
   * List pending escalations
   */
  async listEscalations(): Promise<{ escalations: unknown[] }> {
    return this.client.request('escalation.list', {});
  }

  /**
   * Resolve an escalation
   */
  async resolveEscalation(escalationId: string, resolution: unknown): Promise<{ success: boolean }> {
    return this.client.request('escalation.resolve', { escalationId, resolution });
  }

  // ============================================================================
  // Approval Methods
  // ============================================================================

  /**
   * List pending approvals
   */
  async listApprovals(): Promise<{ approvals: unknown[] }> {
    return this.client.request('approval.list', {});
  }

  /**
   * Approve a request
   */
  async approve(approvalId: string): Promise<{ success: boolean }> {
    return this.client.request('approval.approve', { approvalId });
  }

  /**
   * Reject a request
   */
  async reject(approvalId: string, reason?: string): Promise<{ success: boolean }> {
    return this.client.request('approval.reject', { approvalId, reason });
  }
}
