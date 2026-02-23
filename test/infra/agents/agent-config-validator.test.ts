import {
  AgentConfigValidationError,
  validateAgentConfig,
} from '../../../src/infra/agents/config/agent-config-validator.js';

describe('Agent config validator', () => {
  const validConfig = {
    $schema: 'https://ponybunny.dho.ai/schemas/agent.schema.json',
    schemaVersion: 1,
    id: 'scout',
    name: 'Demo Agent',
    description: 'Growth and pipeline agent',
    enabled: true,
    type: 'growth',
    subAgents: [],
    schedule: {
      everyMs: 30000,
      timezone: 'Europe/London',
      catchUp: { mode: 'coalesce', maxReplayTicks: 10 },
    },
    policy: {
      toolAllowlist: ['llm.classify', 'pg.select'],
      skills: {
        available: ['postgres-*', 'repo-*'],
        denied: ['unsafe-*'],
      },
      mcp: {
        available: ['github.search_repositories', 'postgres.query'],
        denied: ['browser.open_url'],
      },
      forbiddenPatterns: [
        {
          pattern: '.pay',
          description: 'Disallow payment execution',
          severity: 'high',
        },
      ],
      prompts: {
        detect_system: 'Return ONLY valid JSON.',
      },
      limits: {
        lead_summary_max_chars: 1800,
      },
    },
    runner: {
      engine: 'default',
      entrypoint: 'agents.scout.run',
      config: {
        tick_defaults: {
          max_events_per_tick: 150,
          max_tasks_per_tick: 80,
          default_lookback_window: '24h',
        },
        thresholds: {
          hot_lead_score: 75,
        },
        conflict_rules: {
          hold_on_missing_scope_definition: true,
        },
        circuit_breaker: {
          failure_threshold: 5,
          backoff_minutes: 20,
        },
      },
    },
  };

  it('accepts a minimal valid config', () => {
    const result = validateAgentConfig(validConfig);
    expect(result).toEqual(validConfig);
  });

  it('rejects configs with unknown properties', () => {
    const invalidConfig = {
      ...validConfig,
      typo_field: true,
    };

    try {
      validateAgentConfig(invalidConfig);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConfigValidationError);
      const validationError = error as AgentConfigValidationError;
      expect(validationError.errors.some((entry) => entry.path.includes('/typo_field'))).toBe(true);
    }
  });

  it('accepts type-specific growth runner configuration', () => {
    const growthConfig = {
      ...validConfig,
      id: 'growth-agent',
      runner: {
        ...validConfig.runner,
        config: {
          tick_defaults: {
            max_events_per_tick: 200,
            max_tasks_per_tick: 120,
            default_lookback_window: '48h',
          },
          circuit_breaker: {
            failure_threshold: 3,
            backoff_minutes: 15,
          },
        },
      },
    };

    const result = validateAgentConfig(growthConfig);
    expect(result).toEqual(growthConfig);
  });

  it('rejects invalid catch-up mode values', () => {
    const invalidCatchUpConfig = {
      ...validConfig,
      schedule: {
        ...validConfig.schedule,
        catchUp: {
          mode: 'catch_up',
        },
      },
    };

    try {
      validateAgentConfig(invalidCatchUpConfig);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConfigValidationError);
      const validationError = error as AgentConfigValidationError;
      expect(validationError.errors.some((entry) => entry.path.includes('/schedule/catchUp/mode'))).toBe(true);
    }
  });

  it('rejects invalid skills/mcp resource policy shape', () => {
    const invalidResourcePolicyConfig = {
      ...validConfig,
      policy: {
        ...validConfig.policy,
        skills: {
          available: 'postgres-*',
        },
      },
    };

    try {
      validateAgentConfig(invalidResourcePolicyConfig);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConfigValidationError);
      const validationError = error as AgentConfigValidationError;
      expect(validationError.errors.some((entry) => entry.path.includes('/policy/skills/available'))).toBe(true);
    }
  });
});
