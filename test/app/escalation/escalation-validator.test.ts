import { EscalationPacketValidator, createValidator, isValidPacket } from '../../../src/app/escalation/escalation-validator.js';
import type { IEscalationPacket, IEscalationOption } from '../../../src/domain/escalation/types.js';

describe('EscalationPacketValidator', () => {
  let validator: EscalationPacketValidator;

  beforeEach(() => {
    validator = new EscalationPacketValidator();
  });

  function createValidPacket(overrides: Partial<IEscalationPacket> = {}): Partial<IEscalationPacket> {
    const defaultOptions: IEscalationOption[] = [
      {
        id: 'opt-1',
        label: 'Approve',
        description: 'Approve the requested action and proceed',
        action: 'approve',
        isRecommended: true,
        requiresInput: false,
        riskLevel: 'medium',
      },
      {
        id: 'opt-2',
        label: 'Reject',
        description: 'Reject and cancel the operation entirely',
        action: 'reject',
        isRecommended: false,
        requiresInput: false,
        riskLevel: 'low',
      },
    ];

    return {
      workItemId: 'work-item-123',
      goalId: 'goal-456',
      type: 'stuck',
      severity: 'medium',
      title: 'Work item stuck after multiple retries',
      description: 'The work item has been stuck for 30 minutes after 3 retry attempts. The agent is unable to proceed due to a recurring error in the API integration.',
      context: {
        attemptedAction: 'Integrate with external payment API',
        reason: 'API returns 500 error consistently',
        previousAttempts: [
          { attemptNumber: 1, action: 'Direct API call', result: 'failure', error: 'HTTP 500', timestamp: Date.now() - 1800000 },
          { attemptNumber: 2, action: 'Retry with backoff', result: 'failure', error: 'HTTP 500', timestamp: Date.now() - 1200000 },
          { attemptNumber: 3, action: 'Alternative endpoint', result: 'failure', error: 'HTTP 500', timestamp: Date.now() - 600000 },
        ],
        analysis: 'The API appears to be experiencing server-side issues. All retry attempts have failed with the same error.',
        stuckInfo: {
          stuckSince: Date.now() - 1800000,
          stuckReason: 'Repeated API failures',
          retryCount: 3,
          errorSignature: 'HTTP_500_PAYMENT_API',
          suggestedActions: ['Wait for API recovery', 'Use mock API', 'Skip payment integration'],
        },
      },
      options: defaultOptions,
      createdAt: Date.now(),
      createdBy: 'agent-001',
      ...overrides,
    };
  }

  describe('validate', () => {
    it('should validate a complete valid packet', () => {
      const packet = createValidPacket();
      const result = validator.validate(packet);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.completenessScore).toBeGreaterThan(0.8);
    });

    it('should fail validation for missing workItemId', () => {
      const packet = createValidPacket();
      delete packet.workItemId;

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'workItemId')).toBe(true);
    });

    it('should fail validation for missing goalId', () => {
      const packet = createValidPacket();
      delete packet.goalId;

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'goalId')).toBe(true);
    });

    it('should fail validation for invalid type', () => {
      const packet = createValidPacket({ type: 'invalid' as any });

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'type')).toBe(true);
    });

    it('should fail validation for short title', () => {
      const packet = createValidPacket({ title: 'Short' });

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'title')).toBe(true);
    });

    it('should fail validation for short description', () => {
      const packet = createValidPacket({ description: 'Too short' });

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'description')).toBe(true);
    });

    it('should fail validation for missing context', () => {
      const packet = createValidPacket();
      delete packet.context;

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'context')).toBe(true);
    });

    it('should fail validation for insufficient options', () => {
      const packet = createValidPacket({ options: [{ id: '1', label: 'Only one', description: 'Single option', action: 'approve', isRecommended: true, requiresInput: false, riskLevel: 'low' }] });

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'options')).toBe(true);
    });

    it('should warn about missing recommended option', () => {
      const packet = createValidPacket();
      packet.options = packet.options!.map(o => ({ ...o, isRecommended: false }));

      const result = validator.validate(packet);

      expect(result.warnings.some(w => w.message.includes('recommended'))).toBe(true);
    });
  });

  describe('type-specific validation', () => {
    it('should require riskAssessment for risk type', () => {
      const packet = createValidPacket({ type: 'risk' });
      delete (packet.context as any).riskAssessment;
      delete (packet.context as any).stuckInfo; // Remove stuck-specific field

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'context.riskAssessment')).toBe(true);
    });

    it('should validate valid risk packet', () => {
      const packet = createValidPacket({
        type: 'risk',
        context: {
          attemptedAction: 'Delete production database',
          reason: 'User requested cleanup',
          previousAttempts: [],
          analysis: 'This is a high-risk operation that could result in data loss',
          riskAssessment: {
            impact: 'critical',
            likelihood: 'high',
            affectedSystems: ['production-db', 'user-service'],
            reversible: false,
            mitigationOptions: ['Create backup first', 'Use staging environment'],
          },
        },
      });

      const result = validator.validate(packet);

      // Should not have riskAssessment error
      expect(result.errors.filter(e => e.field === 'context.riskAssessment')).toHaveLength(0);
    });

    it('should require requiredCredentials for credential type', () => {
      const packet = createValidPacket({ type: 'credential' });
      delete (packet.context as any).stuckInfo;

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'context.requiredCredentials')).toBe(true);
    });

    it('should validate valid credential packet', () => {
      const packet = createValidPacket({
        type: 'credential',
        context: {
          attemptedAction: 'Access AWS S3 bucket',
          reason: 'Need to upload build artifacts',
          previousAttempts: [],
          analysis: 'AWS credentials are required to access the S3 bucket for artifact storage',
          requiredCredentials: [
            {
              type: 'api_key',
              service: 'AWS',
              scope: 's3:PutObject',
              reason: 'Upload build artifacts to S3',
            },
          ],
        },
      });

      const result = validator.validate(packet);

      expect(result.errors.filter(e => e.field === 'context.requiredCredentials')).toHaveLength(0);
    });

    it('should require stuckInfo for stuck type', () => {
      const packet = createValidPacket({ type: 'stuck' });
      delete (packet.context as any).stuckInfo;

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'context.stuckInfo')).toBe(true);
    });

    it('should require validationResults for validation_failed type', () => {
      const packet = createValidPacket({ type: 'validation_failed' });
      delete (packet.context as any).stuckInfo;

      const result = validator.validate(packet);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'context.validationResults')).toBe(true);
    });

    it('should validate valid validation_failed packet', () => {
      const packet = createValidPacket({
        type: 'validation_failed',
        context: {
          attemptedAction: 'Run test suite',
          reason: 'Tests are failing',
          previousAttempts: [],
          analysis: 'Several unit tests are failing due to recent code changes',
          validationResults: [
            { checkName: 'unit-tests', passed: false, message: '3 tests failed', severity: 'error' },
            { checkName: 'lint', passed: true, message: 'No lint errors', severity: 'info' },
          ],
        },
      });

      const result = validator.validate(packet);

      expect(result.errors.filter(e => e.field === 'context.validationResults')).toHaveLength(0);
    });
  });

  describe('canSubmit', () => {
    it('should return true for valid packet', () => {
      const packet = createValidPacket();
      expect(validator.canSubmit(packet)).toBe(true);
    });

    it('should return false for invalid packet', () => {
      const packet = createValidPacket();
      delete packet.workItemId;
      expect(validator.canSubmit(packet)).toBe(false);
    });

    it('should return false for incomplete packet', () => {
      const packet: Partial<IEscalationPacket> = {
        workItemId: 'work-item-123',
        goalId: 'goal-456',
      };
      expect(validator.canSubmit(packet)).toBe(false);
    });
  });

  describe('getRequiredFields', () => {
    it('should return common required fields for any type', () => {
      const fields = validator.getRequiredFields('stuck');

      expect(fields).toContain('workItemId');
      expect(fields).toContain('goalId');
      expect(fields).toContain('title');
      expect(fields).toContain('description');
      expect(fields).toContain('context');
      expect(fields).toContain('options');
    });

    it('should include stuckInfo for stuck type', () => {
      const fields = validator.getRequiredFields('stuck');
      expect(fields).toContain('context.stuckInfo');
    });

    it('should include riskAssessment for risk type', () => {
      const fields = validator.getRequiredFields('risk');
      expect(fields).toContain('context.riskAssessment');
    });

    it('should include requiredCredentials for credential type', () => {
      const fields = validator.getRequiredFields('credential');
      expect(fields).toContain('context.requiredCredentials');
    });

    it('should include validationResults for validation_failed type', () => {
      const fields = validator.getRequiredFields('validation_failed');
      expect(fields).toContain('context.validationResults');
    });
  });

  describe('buildPacket', () => {
    it('should create a complete packet with defaults', () => {
      const packet = validator.buildPacket({
        workItemId: 'work-item-1',
        goalId: 'goal-1',
      });

      expect(packet.workItemId).toBe('work-item-1');
      expect(packet.goalId).toBe('goal-1');
      expect(packet.type).toBe('stuck');
      expect(packet.severity).toBe('medium');
      expect(packet.options.length).toBeGreaterThanOrEqual(2);
      expect(packet.context).toBeDefined();
      expect(packet.createdAt).toBeDefined();
    });

    it('should preserve provided values', () => {
      const packet = validator.buildPacket({
        workItemId: 'work-item-1',
        goalId: 'goal-1',
        type: 'risk',
        severity: 'critical',
        title: 'Custom Title',
      });

      expect(packet.type).toBe('risk');
      expect(packet.severity).toBe('critical');
      expect(packet.title).toBe('Custom Title');
    });

    it('should merge context with defaults', () => {
      const packet = validator.buildPacket({
        workItemId: 'work-item-1',
        goalId: 'goal-1',
        context: {
          attemptedAction: 'Custom action',
          reason: 'Custom reason',
          previousAttempts: [{ attemptNumber: 1, action: 'test', result: 'failure', timestamp: Date.now() }],
          analysis: 'Custom analysis',
        },
      });

      expect(packet.context.attemptedAction).toBe('Custom action');
      expect(packet.context.reason).toBe('Custom reason');
      expect(packet.context.previousAttempts).toHaveLength(1);
    });
  });

  describe('helper functions', () => {
    it('createValidator should return a validator instance', () => {
      const v = createValidator();
      expect(v).toBeInstanceOf(EscalationPacketValidator);
    });

    it('isValidPacket should return true for valid packet', () => {
      const packet = createValidPacket();
      expect(isValidPacket(packet)).toBe(true);
    });

    it('isValidPacket should return false for invalid packet', () => {
      expect(isValidPacket({})).toBe(false);
    });
  });
});
