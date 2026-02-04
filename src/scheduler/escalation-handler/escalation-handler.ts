/**
 * Escalation Handler Implementation
 *
 * Manages escalations - requests for human intervention when
 * the system encounters situations it cannot handle autonomously.
 */

import type {
  Escalation,
  EscalationStatus,
  EscalationSeverity,
  EscalationType,
  EscalationContext,
  ResolutionAction,
} from '../../work-order/types/index.js';
import type {
  IEscalationHandler,
  EscalationCreateParams,
  EscalationResolveParams,
  EscalationFilter,
  EscalationStats,
} from './types.js';

/**
 * Repository interface for escalation persistence
 */
export interface IEscalationRepository {
  createEscalation(params: {
    work_item_id: string;
    goal_id: string;
    run_id?: string;
    escalation_type: EscalationType;
    severity: EscalationSeverity;
    title: string;
    description: string;
    context_data?: EscalationContext;
  }): Escalation;

  getEscalation(id: string): Escalation | undefined;

  updateEscalationStatus(id: string, status: EscalationStatus): void;

  resolveEscalation(
    id: string,
    params: {
      resolution_action: ResolutionAction;
      resolution_data?: Record<string, unknown>;
      resolver: string;
    }
  ): void;

  getOpenEscalations(goalId?: string): Escalation[];

  getEscalationsByGoal(goalId: string): Escalation[];

  getEscalationsByWorkItem(workItemId: string): Escalation[];
}

/**
 * Severity priority for sorting (higher = more urgent)
 */
const SEVERITY_PRIORITY: Record<EscalationSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Escalation types that block goal progress
 */
const BLOCKING_TYPES: EscalationType[] = [
  'stuck',
  'credential',
  'risk',
];

export class EscalationHandler implements IEscalationHandler {
  private escalations: Map<string, Escalation> = new Map();
  private nextId = 1;

  constructor(private repository?: IEscalationRepository) {}

  /**
   * Create a new escalation
   */
  async createEscalation(params: EscalationCreateParams): Promise<Escalation> {
    if (this.repository) {
      return this.repository.createEscalation({
        work_item_id: params.workItemId,
        goal_id: params.goalId,
        run_id: params.runId,
        escalation_type: params.type,
        severity: params.severity,
        title: params.title,
        description: params.description,
        context_data: params.context,
      });
    }

    // In-memory implementation for testing
    const escalation: Escalation = {
      id: `esc-${this.nextId++}`,
      created_at: Date.now(),
      work_item_id: params.workItemId,
      goal_id: params.goalId,
      run_id: params.runId,
      escalation_type: params.type,
      severity: params.severity,
      status: 'open',
      title: params.title,
      description: params.description,
      context_data: params.context,
    };

    this.escalations.set(escalation.id, escalation);
    return escalation;
  }

  /**
   * Resolve an escalation
   */
  async resolveEscalation(params: EscalationResolveParams): Promise<void> {
    if (this.repository) {
      this.repository.resolveEscalation(params.escalationId, {
        resolution_action: params.action,
        resolution_data: params.data,
        resolver: params.resolver,
      });
      return;
    }

    // In-memory implementation
    const escalation = this.escalations.get(params.escalationId);
    if (!escalation) {
      throw new Error(`Escalation not found: ${params.escalationId}`);
    }

    if (escalation.status === 'resolved' || escalation.status === 'dismissed') {
      throw new Error(`Escalation already closed: ${params.escalationId}`);
    }

    this.escalations.set(params.escalationId, {
      ...escalation,
      status: 'resolved',
      resolved_at: Date.now(),
      resolution_action: params.action,
      resolution_data: params.data,
      resolver: params.resolver,
    });
  }

  /**
   * Acknowledge an escalation
   */
  async acknowledgeEscalation(escalationId: string, _acknowledger: string): Promise<void> {
    if (this.repository) {
      this.repository.updateEscalationStatus(escalationId, 'acknowledged');
      return;
    }

    const escalation = this.escalations.get(escalationId);
    if (!escalation) {
      throw new Error(`Escalation not found: ${escalationId}`);
    }

    if (escalation.status !== 'open') {
      throw new Error(`Can only acknowledge open escalations: ${escalationId}`);
    }

    this.escalations.set(escalationId, {
      ...escalation,
      status: 'acknowledged',
    });
  }

  /**
   * Dismiss an escalation without resolution
   */
  async dismissEscalation(escalationId: string, reason: string): Promise<void> {
    if (this.repository) {
      this.repository.resolveEscalation(escalationId, {
        resolution_action: 'skip',
        resolution_data: { dismissReason: reason },
        resolver: 'system',
      });
      this.repository.updateEscalationStatus(escalationId, 'dismissed');
      return;
    }

    const escalation = this.escalations.get(escalationId);
    if (!escalation) {
      throw new Error(`Escalation not found: ${escalationId}`);
    }

    if (escalation.status === 'resolved' || escalation.status === 'dismissed') {
      throw new Error(`Escalation already closed: ${escalationId}`);
    }

    this.escalations.set(escalationId, {
      ...escalation,
      status: 'dismissed',
      resolved_at: Date.now(),
      resolution_action: 'skip',
      resolution_data: { dismissReason: reason },
      resolver: 'system',
    });
  }

  /**
   * Get escalation by ID
   */
  async getEscalation(escalationId: string): Promise<Escalation | null> {
    if (this.repository) {
      return this.repository.getEscalation(escalationId) || null;
    }
    return this.escalations.get(escalationId) || null;
  }

  /**
   * Get pending (open/acknowledged) escalations for a goal
   */
  async getPendingEscalations(goalId: string): Promise<Escalation[]> {
    if (this.repository) {
      return this.repository.getOpenEscalations(goalId);
    }

    return Array.from(this.escalations.values())
      .filter(
        (e) =>
          e.goal_id === goalId &&
          (e.status === 'open' || e.status === 'acknowledged')
      )
      .sort((a, b) => {
        // Sort by severity (highest first), then by creation time (oldest first)
        const severityDiff =
          SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return a.created_at - b.created_at;
      });
  }

  /**
   * Get all escalations matching filter
   */
  async getEscalations(filter: EscalationFilter): Promise<Escalation[]> {
    let escalations: Escalation[];

    if (this.repository) {
      if (filter.goalId) {
        escalations = this.repository.getEscalationsByGoal(filter.goalId);
      } else if (filter.workItemId) {
        escalations = this.repository.getEscalationsByWorkItem(filter.workItemId);
      } else {
        escalations = this.repository.getOpenEscalations();
      }
    } else {
      escalations = Array.from(this.escalations.values());
    }

    // Apply filters
    return escalations.filter((e) => {
      if (filter.goalId && e.goal_id !== filter.goalId) return false;
      if (filter.workItemId && e.work_item_id !== filter.workItemId) return false;
      if (filter.status && e.status !== filter.status) return false;
      if (filter.severity && e.severity !== filter.severity) return false;
      if (filter.type && e.escalation_type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Get escalation statistics
   */
  async getStats(goalId?: string): Promise<EscalationStats> {
    const escalations = goalId
      ? await this.getEscalations({ goalId })
      : Array.from(this.escalations.values());

    const stats: EscalationStats = {
      total: escalations.length,
      byStatus: {
        open: 0,
        acknowledged: 0,
        resolved: 0,
        dismissed: 0,
      },
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
      byType: {
        stuck: 0,
        ambiguous: 0,
        risk: 0,
        credential: 0,
        validation_failed: 0,
      },
    };

    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const e of escalations) {
      stats.byStatus[e.status]++;
      stats.bySeverity[e.severity]++;
      stats.byType[e.escalation_type]++;

      if (e.resolved_at && e.status === 'resolved') {
        totalResolutionTime += e.resolved_at - e.created_at;
        resolvedCount++;
      }
    }

    if (resolvedCount > 0) {
      stats.averageResolutionTimeMs = totalResolutionTime / resolvedCount;
    }

    return stats;
  }

  /**
   * Check if there are any blocking escalations for a goal
   */
  async hasBlockingEscalations(goalId: string): Promise<boolean> {
    const pending = await this.getPendingEscalations(goalId);
    return pending.some(
      (e) =>
        BLOCKING_TYPES.includes(e.escalation_type) ||
        e.severity === 'critical' ||
        e.severity === 'high'
    );
  }

  /**
   * Get the highest severity pending escalation for a goal
   */
  async getHighestSeverityEscalation(goalId: string): Promise<Escalation | null> {
    const pending = await this.getPendingEscalations(goalId);
    if (pending.length === 0) return null;

    // Already sorted by severity in getPendingEscalations
    return pending[0];
  }

  /**
   * Clear all escalations (for testing)
   */
  clear(): void {
    this.escalations.clear();
    this.nextId = 1;
  }
}
