/**
 * Escalation Handler Types
 */

import type {
  Escalation,
  EscalationType,
  EscalationSeverity,
  EscalationStatus,
  EscalationContext,
  ResolutionAction,
} from '../../work-order/types/index.js';

export interface EscalationCreateParams {
  workItemId: string;
  goalId: string;
  runId?: string;
  type: EscalationType;
  severity: EscalationSeverity;
  title: string;
  description: string;
  context?: EscalationContext;
}

export interface EscalationResolveParams {
  escalationId: string;
  action: ResolutionAction;
  resolver: string;
  data?: Record<string, unknown>;
}

export interface EscalationFilter {
  goalId?: string;
  workItemId?: string;
  status?: EscalationStatus;
  severity?: EscalationSeverity;
  type?: EscalationType;
}

export interface EscalationStats {
  total: number;
  byStatus: Record<EscalationStatus, number>;
  bySeverity: Record<EscalationSeverity, number>;
  byType: Record<EscalationType, number>;
  averageResolutionTimeMs?: number;
}

export interface IEscalationHandler {
  /** Create a new escalation */
  createEscalation(params: EscalationCreateParams): Promise<Escalation>;

  /** Resolve an escalation */
  resolveEscalation(params: EscalationResolveParams): Promise<void>;

  /** Acknowledge an escalation (mark as being worked on) */
  acknowledgeEscalation(escalationId: string, acknowledger: string): Promise<void>;

  /** Dismiss an escalation without resolution */
  dismissEscalation(escalationId: string, reason: string): Promise<void>;

  /** Get escalation by ID */
  getEscalation(escalationId: string): Promise<Escalation | null>;

  /** Get pending (open/acknowledged) escalations for a goal */
  getPendingEscalations(goalId: string): Promise<Escalation[]>;

  /** Get all escalations matching filter */
  getEscalations(filter: EscalationFilter): Promise<Escalation[]>;

  /** Get escalation statistics */
  getStats(goalId?: string): Promise<EscalationStats>;

  /** Check if there are any blocking escalations for a goal */
  hasBlockingEscalations(goalId: string): Promise<boolean>;

  /** Get the highest severity pending escalation for a goal */
  getHighestSeverityEscalation(goalId: string): Promise<Escalation | null>;
}
