import path from 'node:path';
import { DeterministicSchemaValidator } from '../../src/deterministic-runtime/schema-validator.js';

describe('DeterministicSchemaValidator', () => {
  const validator = new DeterministicSchemaValidator(
    path.resolve(process.cwd(), 'src', 'deterministic-runtime', 'schemas')
  );

  it('validates a minimal valid plan schema payload', () => {
    const result = validator.validate('plan', {
      schema_version: 'plan.v1',
      plan_id: 'plan-12345678',
      goal: 'test deterministic plan',
      steps: [
        {
          id: 'step_1',
          type: 'tool_call',
          tool_ref: 'local://read_file',
          args: {},
        },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns deterministic errors for invalid plan payload', () => {
    const result = validator.validate('plan', {
      schema_version: 'plan.v1',
      plan_id: 'plan-short',
      steps: [
        {
          id: 'step_1',
          type: 'tool_call',
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.path.includes('/goal'))).toBe(true);
  });

  it('validates runtime profile schema payload', () => {
    const result = validator.validate('runtime_profile', {
      profile_id: 'default-profile',
      tool_routing: {
        mode: 'system_only',
        allow_model_native_tools: false,
        resolution_order: ['skills', 'mcp', 'local_tools'],
      },
      policy: {
        default_network: 'deny',
        default_filesystem_scope: {
          read: ['/tmp'],
          write: ['/tmp'],
        },
      },
    });

    expect(result.valid).toBe(true);
  });

  it('validates tool manifest schema payload', () => {
    const result = validator.validate('tool_manifest', {
      tool_ref: 'mcp://playwright.navigate',
      display_name: 'Playwright Navigate',
      input_schema: { type: 'object', properties: {} },
      output_schema: { type: 'object', properties: {} },
      side_effect: 'none',
      permissions: {
        network: 'allow',
      },
    });

    expect(result.valid).toBe(true);
  });
});
