import Ajv2020 from 'ajv/dist/2020.js';
import type { AgentConfig, CompiledAgentConfig } from './agent-config-types.js';
import { compileAgentConfig } from './agent-config-types.js';

export class AgentConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = 'AgentConfigValidationError';
  }
}

const EMBEDDED_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/agent.schema.json',
  title: 'PonyBunny Agent Configuration',
  description: 'Configuration for a single PonyBunny agent',
  type: 'object',
  required: ['schemaVersion', 'id', 'name', 'enabled', 'type', 'schedule', 'policy', 'runner'],
  properties: {
    $schema: { type: 'string' },
    schemaVersion: { type: 'integer', enum: [1] },
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
    type: { type: 'string', minLength: 1 },
    schedule: { $ref: '#/$defs/Schedule' },
    policy: { $ref: '#/$defs/Policy' },
    runner: { $ref: '#/$defs/Runner' },
  },
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: {
          type: { const: 'react_goal' },
        },
      },
      then: {
        properties: {
          runner: {
            type: 'object',
            required: ['config'],
            properties: {
              config: { $ref: '#/$defs/ReactGoalRunnerConfig' },
            },
            additionalProperties: false,
          },
        },
      },
    },
  ],
  $defs: {
    Schedule: {
      type: 'object',
      properties: {
        cron: { type: 'string', minLength: 1 },
        everyMs: { type: 'integer', minimum: 1 },
        tz: { type: 'string', minLength: 1 },
        catchUp: { $ref: '#/$defs/CatchUpPolicy' },
      },
      additionalProperties: false,
      oneOf: [
        { required: ['cron'], not: { required: ['everyMs'] } },
        { required: ['everyMs'], not: { required: ['cron'] } },
      ],
    },
    CatchUpPolicy: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['coalesce', 'catch_up'] },
        maxCatchUpWindowMs: { type: 'integer', minimum: 0 },
        maxRunsPerTick: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    Policy: {
      type: 'object',
      properties: {
        toolAllowlist: { type: 'array', items: { type: 'string' } },
        forbiddenPatterns: {
          type: 'array',
          items: { $ref: '#/$defs/ForbiddenPattern' },
        },
        prompts: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        limits: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
      additionalProperties: false,
    },
    ForbiddenPattern: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', minLength: 1 },
        category: {
          type: 'string',
          enum: ['filesystem', 'shell', 'network', 'database', 'git', 'code', 'browser', 'system'],
        },
        description: { type: 'string' },
        severity: { type: 'string', enum: ['high', 'critical'] },
        id: { type: 'string' },
        examples: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    Runner: {
      type: 'object',
      properties: {
        config: { type: 'object' },
      },
      additionalProperties: false,
    },
    ReactGoalBudget: {
      type: 'object',
      properties: {
        tokens: { type: 'number', minimum: 0 },
        time_minutes: { type: 'number', minimum: 0 },
        cost_usd: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    },
    ReactGoalRunnerConfig: {
      type: 'object',
      required: ['goal_title_template', 'goal_description_template'],
      properties: {
        goal_title_template: { type: 'string', minLength: 1 },
        goal_description_template: { type: 'string', minLength: 1 },
        budget: { $ref: '#/$defs/ReactGoalBudget' },
        model_hint: { type: 'string', minLength: 1 },
        tool_allowlist: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
      additionalProperties: false,
    },
  },
};

function createValidator(): Ajv2020 {
  return new Ajv2020({ allErrors: true, strict: false });
}

function formatErrorPath(error: { instancePath?: string; keyword?: string; params?: any }): string {
  const instancePath = error.instancePath ?? '';

  if (error.keyword === 'additionalProperties' && typeof error.params?.additionalProperty === 'string') {
    const suffix = error.params.additionalProperty;
    return instancePath ? `${instancePath}/${suffix}` : `/${suffix}`;
  }

  if (error.keyword === 'required' && typeof error.params?.missingProperty === 'string') {
    const suffix = error.params.missingProperty;
    return instancePath ? `${instancePath}/${suffix}` : `/${suffix}`;
  }

  return instancePath || '/';
}

export function validateAgentConfig(config: unknown): AgentConfig {
  const ajv = createValidator();
  const validate = ajv.compile(EMBEDDED_SCHEMA);

  if (!validate(config)) {
    const errors = (validate.errors || []).map((err) => ({
      path: formatErrorPath(err),
      message: err.message || 'Unknown validation error',
    }));

    throw new AgentConfigValidationError(
      `Invalid agent configuration: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      errors
    );
  }

  return config as unknown as AgentConfig;
}

export function validateAndCompileAgentConfig(config: unknown): CompiledAgentConfig {
  return compileAgentConfig(validateAgentConfig(config));
}
