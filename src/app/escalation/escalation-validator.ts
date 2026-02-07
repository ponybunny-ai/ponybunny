/**
 * Escalation Packet Validator
 *
 * Validates escalation packets to ensure they contain all required
 * information for human review and decision-making.
 */

import { randomUUID } from 'node:crypto';
import type {
  IEscalationPacket,
  IEscalationPacketValidator,
  IEscalationPacketContext,
  IEscalationOption,
  IValidationError,
  IValidationRule,
} from '../../domain/escalation/types.js';
import type { EscalationType } from '../../work-order/types/index.js';

// ============================================================================
// Validation Result Type (local to avoid conflict)
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: IValidationError[];
  warnings: IValidationError[];
  completenessScore: number;
}

// ============================================================================
// Validation Rules
// ============================================================================

const COMMON_RULES: IValidationRule[] = [
  {
    field: 'workItemId',
    required: true,
    validator: (v) => typeof v === 'string' && v.length > 0,
    errorMessage: 'Work item ID is required',
  },
  {
    field: 'goalId',
    required: true,
    validator: (v) => typeof v === 'string' && v.length > 0,
    errorMessage: 'Goal ID is required',
  },
  {
    field: 'type',
    required: true,
    validator: (v) => ['stuck', 'ambiguous', 'risk', 'credential', 'validation_failed'].includes(v as string),
    errorMessage: 'Valid escalation type is required',
  },
  {
    field: 'severity',
    required: true,
    validator: (v) => ['low', 'medium', 'high', 'critical'].includes(v as string),
    errorMessage: 'Valid severity level is required',
  },
  {
    field: 'title',
    required: true,
    validator: (v) => typeof v === 'string' && v.length >= 10 && v.length <= 200,
    errorMessage: 'Title must be between 10 and 200 characters',
  },
  {
    field: 'description',
    required: true,
    validator: (v) => typeof v === 'string' && v.length >= 50,
    errorMessage: 'Description must be at least 50 characters',
  },
  {
    field: 'context',
    required: true,
    validator: (v) => v !== null && typeof v === 'object',
    errorMessage: 'Context object is required',
  },
  {
    field: 'context.attemptedAction',
    required: true,
    validator: (v, p) => typeof (p.context as any)?.attemptedAction === 'string' && (p.context as any).attemptedAction.length > 0,
    errorMessage: 'Attempted action description is required',
  },
  {
    field: 'context.reason',
    required: true,
    validator: (v, p) => typeof (p.context as any)?.reason === 'string' && (p.context as any).reason.length > 0,
    errorMessage: 'Reason for escalation is required',
  },
  {
    field: 'context.previousAttempts',
    required: true,
    validator: (v, p) => Array.isArray((p.context as any)?.previousAttempts),
    errorMessage: 'Previous attempts array is required (can be empty)',
  },
  {
    field: 'context.analysis',
    required: true,
    validator: (v, p) => typeof (p.context as any)?.analysis === 'string' && (p.context as any).analysis.length >= 20,
    errorMessage: 'Analysis must be at least 20 characters',
  },
  {
    field: 'options',
    required: true,
    validator: (v) => Array.isArray(v) && v.length >= 2,
    errorMessage: 'At least 2 resolution options are required',
  },
];

const TYPE_SPECIFIC_RULES: IValidationRule[] = [
  // Risk escalations require risk assessment
  {
    field: 'context.riskAssessment',
    required: true,
    validator: (v, p) => {
      const ra = (p.context as any)?.riskAssessment;
      return ra &&
        ['low', 'medium', 'high', 'critical'].includes(ra.impact) &&
        ['low', 'medium', 'high'].includes(ra.likelihood) &&
        Array.isArray(ra.affectedSystems) &&
        typeof ra.reversible === 'boolean';
    },
    errorMessage: 'Risk assessment with impact, likelihood, affectedSystems, and reversible is required',
    appliesTo: ['risk'],
  },
  // Credential escalations require credential requirements
  {
    field: 'context.requiredCredentials',
    required: true,
    validator: (v, p) => {
      const creds = (p.context as any)?.requiredCredentials;
      return Array.isArray(creds) && creds.length > 0 &&
        creds.every((c: any) => c.type && c.service && c.scope && c.reason);
    },
    errorMessage: 'Required credentials with type, service, scope, and reason are required',
    appliesTo: ['credential'],
  },
  // Validation failed escalations require validation results
  {
    field: 'context.validationResults',
    required: true,
    validator: (v, p) => {
      const results = (p.context as any)?.validationResults;
      return Array.isArray(results) && results.length > 0 &&
        results.every((r: any) => r.checkName && typeof r.passed === 'boolean' && r.message);
    },
    errorMessage: 'Validation results with checkName, passed, and message are required',
    appliesTo: ['validation_failed'],
  },
  // Stuck escalations require stuck info
  {
    field: 'context.stuckInfo',
    required: true,
    validator: (v, p) => {
      const info = (p.context as any)?.stuckInfo;
      return info &&
        typeof info.stuckSince === 'number' &&
        typeof info.stuckReason === 'string' &&
        typeof info.retryCount === 'number' &&
        Array.isArray(info.suggestedActions);
    },
    errorMessage: 'Stuck info with stuckSince, stuckReason, retryCount, and suggestedActions is required',
    appliesTo: ['stuck'],
  },
];

// ============================================================================
// Validator Implementation
// ============================================================================

export class EscalationPacketValidator implements IEscalationPacketValidator {
  private rules: IValidationRule[];

  constructor(additionalRules: IValidationRule[] = []) {
    this.rules = [...COMMON_RULES, ...TYPE_SPECIFIC_RULES, ...additionalRules];
  }

  /**
   * Validate an escalation packet
   */
  validate(packet: Partial<IEscalationPacket>): ValidationResult {
    const errors: IValidationError[] = [];
    const warnings: IValidationError[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    for (const rule of this.rules) {
      // Check if rule applies to this escalation type
      if (rule.appliesTo && packet.type && !rule.appliesTo.includes(packet.type)) {
        continue;
      }

      totalChecks++;

      const value = this.getFieldValue(packet, rule.field);
      const isValid = rule.validator(value, packet);

      if (!isValid) {
        if (rule.required) {
          errors.push({
            field: rule.field,
            message: rule.errorMessage,
            severity: 'error',
          });
        } else {
          warnings.push({
            field: rule.field,
            message: rule.errorMessage,
            severity: 'warning',
          });
          passedChecks += 0.5; // Partial credit for optional fields
        }
      } else {
        passedChecks++;
      }
    }

    // Additional checks for options quality
    if (Array.isArray(packet.options)) {
      const optionWarnings = this.validateOptions(packet.options);
      warnings.push(...optionWarnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      completenessScore: totalChecks > 0 ? passedChecks / totalChecks : 0,
    };
  }

  /**
   * Check if a packet is complete enough to submit
   */
  canSubmit(packet: Partial<IEscalationPacket>): boolean {
    const result = this.validate(packet);
    return result.valid && result.completenessScore >= 0.8;
  }

  /**
   * Get required fields for an escalation type
   */
  getRequiredFields(type: EscalationType): string[] {
    const fields: string[] = [];

    for (const rule of this.rules) {
      if (rule.required) {
        if (!rule.appliesTo || rule.appliesTo.includes(type)) {
          fields.push(rule.field);
        }
      }
    }

    return fields;
  }

  /**
   * Build a complete packet from partial data
   */
  buildPacket(data: Partial<IEscalationPacket>): IEscalationPacket {
    const now = Date.now();

    // Build default context
    const defaultContext: IEscalationPacketContext = {
      attemptedAction: '',
      reason: '',
      previousAttempts: [],
      analysis: '',
      ...data.context,
    };

    // Build default options if not provided
    const defaultOptions: IEscalationOption[] = data.options || [
      {
        id: randomUUID(),
        label: 'Approve',
        description: 'Approve the requested action',
        action: 'approve',
        isRecommended: false,
        requiresInput: false,
        riskLevel: 'medium',
      },
      {
        id: randomUUID(),
        label: 'Reject',
        description: 'Reject and cancel the operation',
        action: 'reject',
        isRecommended: false,
        requiresInput: false,
        riskLevel: 'low',
      },
    ];

    return {
      workItemId: data.workItemId || '',
      goalId: data.goalId || '',
      runId: data.runId,
      type: data.type || 'stuck',
      severity: data.severity || 'medium',
      title: data.title || 'Escalation Required',
      description: data.description || '',
      context: defaultContext,
      options: defaultOptions,
      createdAt: data.createdAt || now,
      createdBy: data.createdBy || 'unknown',
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getFieldValue(packet: Partial<IEscalationPacket>, field: string): unknown {
    const parts = field.split('.');
    let value: any = packet;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }

  private validateOptions(options: IEscalationOption[]): IValidationError[] {
    const warnings: IValidationError[] = [];

    // Check for recommended option
    const hasRecommended = options.some(o => o.isRecommended);
    if (!hasRecommended) {
      warnings.push({
        field: 'options',
        message: 'Consider marking one option as recommended',
        severity: 'warning',
      });
    }

    // Check for variety of risk levels
    const riskLevels = new Set(options.map(o => o.riskLevel));
    if (riskLevels.size === 1) {
      warnings.push({
        field: 'options',
        message: 'Options should include varying risk levels',
        severity: 'warning',
      });
    }

    // Check option descriptions
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (!opt.id) {
        warnings.push({
          field: `options[${i}].id`,
          message: 'Option should have an ID',
          severity: 'warning',
        });
      }
      if (opt.description.length < 10) {
        warnings.push({
          field: `options[${i}].description`,
          message: 'Option description should be more detailed',
          severity: 'warning',
        });
      }
      if (opt.requiresInput && !opt.inputPrompt) {
        warnings.push({
          field: `options[${i}].inputPrompt`,
          message: 'Options requiring input should have an input prompt',
          severity: 'warning',
        });
      }
    }

    return warnings;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a pre-configured validator for common use cases
 */
export function createValidator(): EscalationPacketValidator {
  return new EscalationPacketValidator();
}

/**
 * Quick validation check
 */
export function isValidPacket(packet: Partial<IEscalationPacket>): boolean {
  const validator = new EscalationPacketValidator();
  return validator.canSubmit(packet);
}
