/**
 * Escalation Packet Types
 *
 * Types for validating escalation packets to ensure they contain
 * all required information for human review.
 */

import type { EscalationType, EscalationSeverity, EscalationContext } from '../../work-order/types/index.js';

// ============================================================================
// Escalation Packet Definition
// ============================================================================

/**
 * Complete escalation packet with all required fields for human review
 */
export interface IEscalationPacket {
  // Core identification
  workItemId: string;
  goalId: string;
  runId?: string;

  // Escalation details
  type: EscalationType;
  severity: EscalationSeverity;
  title: string;
  description: string;

  // Context (required for informed decision-making)
  context: IEscalationPacketContext;

  // Options for resolution
  options: IEscalationOption[];

  // Metadata
  createdAt: number;
  createdBy: string;  // Agent ID that created the escalation
}

/**
 * Detailed context for the escalation
 */
export interface IEscalationPacketContext {
  // What was being attempted
  attemptedAction: string;

  // What went wrong or why escalation is needed
  reason: string;

  // Previous attempts and their outcomes
  previousAttempts: IAttemptRecord[];

  // Analysis of the situation
  analysis: string;

  // Relevant code/file references
  references?: ICodeReference[];

  // Risk assessment (required for 'risk' type escalations)
  riskAssessment?: IRiskAssessment;

  // Required credentials/permissions (required for 'credential' type)
  requiredCredentials?: ICredentialRequirement[];

  // Validation results (required for 'validation_failed' type)
  validationResults?: IValidationCheckResult[];

  // Stuck detection info (for 'stuck' type)
  stuckInfo?: IStuckInfo;

  // Additional context
  additionalContext?: Record<string, unknown>;
}

export interface IAttemptRecord {
  attemptNumber: number;
  action: string;
  result: 'success' | 'failure' | 'partial';
  error?: string;
  timestamp: number;
}

export interface ICodeReference {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  snippet?: string;
  relevance: string;
}

export interface IRiskAssessment {
  impact: 'low' | 'medium' | 'high' | 'critical';
  likelihood: 'low' | 'medium' | 'high';
  affectedSystems: string[];
  reversible: boolean;
  mitigationOptions?: string[];
}

export interface ICredentialRequirement {
  type: 'api_key' | 'password' | 'token' | 'certificate' | 'ssh_key' | 'other';
  service: string;
  scope: string;
  reason: string;
}

export interface IValidationCheckResult {
  checkName: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface IStuckInfo {
  stuckSince: number;
  stuckReason: string;
  retryCount: number;
  errorSignature?: string;
  suggestedActions: string[];
}

/**
 * Resolution option for the escalation
 */
export interface IEscalationOption {
  id: string;
  label: string;
  description: string;
  action: 'approve' | 'reject' | 'modify' | 'retry' | 'skip' | 'escalate_further';
  isRecommended: boolean;
  requiresInput: boolean;
  inputPrompt?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

// ============================================================================
// Validation Types
// ============================================================================

export interface IValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface IValidationResult {
  valid: boolean;
  errors: IValidationError[];
  warnings: IValidationError[];
  completenessScore: number;  // 0-1, how complete the packet is
}

// ============================================================================
// Validation Rules
// ============================================================================

export interface IValidationRule {
  field: string;
  required: boolean;
  validator: (value: unknown, packet: Partial<IEscalationPacket>) => boolean;
  errorMessage: string;
  appliesTo?: EscalationType[];  // If specified, only applies to these types
}

// ============================================================================
// Validator Interface
// ============================================================================

export interface IEscalationPacketValidator {
  /**
   * Validate an escalation packet
   */
  validate(packet: Partial<IEscalationPacket>): IValidationResult;

  /**
   * Check if a packet is complete enough to submit
   */
  canSubmit(packet: Partial<IEscalationPacket>): boolean;

  /**
   * Get required fields for an escalation type
   */
  getRequiredFields(type: EscalationType): string[];

  /**
   * Build a complete packet from partial data
   */
  buildPacket(data: Partial<IEscalationPacket>): IEscalationPacket;
}
