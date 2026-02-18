import {
  AgentConfigValidationError,
  validateAgentConfig,
} from '../../../src/infra/agents/config/agent-config-validator.js';

describe('Agent config validator', () => {
  const validConfig = {
    schemaVersion: 1,
    id: 'demo-agent',
    name: 'Demo Agent',
    enabled: true,
    type: 'market_listener',
    schedule: {
      cron: '0 * * * *',
      tz: 'UTC',
      catchUp: { mode: 'coalesce' },
    },
    policy: {
      toolAllowlist: ['*'],
    },
    runner: {},
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
      expect(validationError.errors[0].path).toContain('/typo_field');
    }
  });

  it('accepts react_goal config with required templates', () => {
    const reactGoalConfig = {
      ...validConfig,
      type: 'react_goal',
      runner: {
        config: {
          goal_title_template: 'Investigate {{signal}}',
          goal_description_template: 'Follow up on {{signal}} from {{source}}',
          model_hint: 'gpt-4.1-mini',
          tool_allowlist: ['read', 'grep'],
          budget: {
            tokens: 1000,
            time_minutes: 10,
            cost_usd: 0.5,
          },
        },
      },
    };

    const result = validateAgentConfig(reactGoalConfig);
    expect(result).toEqual(reactGoalConfig);
  });

  it('rejects react_goal config missing required template', () => {
    const reactGoalConfig = {
      ...validConfig,
      type: 'react_goal',
      runner: {
        config: {
          goal_title_template: 'Investigate {{signal}}',
        },
      },
    };

    try {
      validateAgentConfig(reactGoalConfig);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConfigValidationError);
      const validationError = error as AgentConfigValidationError;
      expect(validationError.errors.some((entry) => entry.path.includes('/runner/config'))).toBe(true);
    }
  });

  it('rejects react_goal config with unknown runner fields', () => {
    const reactGoalConfig = {
      ...validConfig,
      type: 'react_goal',
      runner: {
        config: {
          goal_title_template: 'Investigate {{signal}}',
          goal_description_template: 'Follow up on {{signal}}',
          unexpected: true,
        },
      },
    };

    try {
      validateAgentConfig(reactGoalConfig);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConfigValidationError);
      const validationError = error as AgentConfigValidationError;
      expect(validationError.errors.some((entry) => entry.path.includes('/runner/config/unexpected')))
        .toBe(true);
    }
  });
});
