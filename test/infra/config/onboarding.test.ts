import {
  CREDENTIALS_TEMPLATE,
  LLM_CONFIG_TEMPLATE,
  MCP_CONFIG_TEMPLATE,
  getOnboardingFiles,
  getPonyBunnyConfigTemplate,
} from '../../../src/infra/config/onboarding.js';

describe('Onboarding config generation', () => {
  it('uses hosted schema URLs in generated templates', () => {
    expect(CREDENTIALS_TEMPLATE.$schema).toBe('https://ponybunny.dho.ai/schemas/credentials.schema.json');
    expect(LLM_CONFIG_TEMPLATE.$schema).toBe('https://ponybunny.dho.ai/schemas/llm-config.schema.json');
    expect(typeof MCP_CONFIG_TEMPLATE.mcpServers).toBe('object');
    expect(getPonyBunnyConfigTemplate().$schema).toBe('https://ponybunny.dho.ai/schemas/ponybunny.schema.json');
  });

  it('loads llm init template from docs/config-templates when available', () => {
    const models = LLM_CONFIG_TEMPLATE.models as unknown as Record<string, Record<string, unknown>>;
    const providers = LLM_CONFIG_TEMPLATE.providers as unknown as Record<string, { protocol: string }>;
    expect(Object.keys(models).length).toBeGreaterThan(0);
    expect(models.openai?.['gpt-5.2']).toBeDefined();
    expect(providers.openai?.protocol).toBe('openai');
    expect(LLM_CONFIG_TEMPLATE.tiers.simple.primary).toBe('anthropic.claude-sonnet-4-5-20250929');
  });

  it('does not include schema files in pb init output', () => {
    const names = new Set(getOnboardingFiles().map((file) => file.name));

    expect(names.has('ponybunny.schema.json')).toBe(false);
    expect(names.has('credentials.schema.json')).toBe(false);
    expect(names.has('llm-config.schema.json')).toBe(false);
    expect(names.has('mcp-config.schema.json')).toBe(false);

    expect(names.has('ponybunny.json')).toBe(true);
    expect(names.has('credentials.json')).toBe(true);
    expect(names.has('llm-config.json')).toBe(true);
    expect(names.has('mcp-config.json')).toBe(true);
  });

  it('includes agent customization seed files for all built-in agents', () => {
    const names = new Set(getOnboardingFiles().map((file) => file.name));

    expect(names.has('agents/forge/agent.json')).toBe(true);
    expect(names.has('agents/guard/agent.json')).toBe(true);
    expect(names.has('agents/keeper/agent.json')).toBe(true);
    expect(names.has('agents/lead/agent.json')).toBe(true);
    expect(names.has('agents/scout/agent.json')).toBe(true);

    expect(names.has('agents/forge/AGENT.md')).toBe(true);
    expect(names.has('agents/guard/AGENT.md')).toBe(true);
    expect(names.has('agents/keeper/AGENT.md')).toBe(true);
    expect(names.has('agents/lead/AGENT.md')).toBe(true);
    expect(names.has('agents/scout/AGENT.md')).toBe(true);
  });

  it('includes project skill files in init output for user config seeding', () => {
    const names = new Set(getOnboardingFiles().map((file) => file.name));

    expect(names.has('skills/control-tick/SKILL.md')).toBe(true);
    expect(names.has('skills/source-read-stream/SKILL.md')).toBe(true);
  });

  it('generates example persona prompt override content in ponybunny template', () => {
    const template = getPonyBunnyConfigTemplate() as {
      persona: {
        promptOverrides: {
          personalityDescription: string;
          guidelines: string;
        };
      };
      tui: {
        sessionFirstEnabled: boolean;
        goalSubmitFastPathEnabled: boolean;
      };
    };
    expect(template.persona.promptOverrides.personalityDescription).toBe('');
    expect(template.persona.promptOverrides.guidelines).toBe('');
    expect(typeof template.tui.sessionFirstEnabled).toBe('boolean');
    expect(typeof template.tui.goalSubmitFastPathEnabled).toBe('boolean');
  });

  it('prefers docs/config-templates for ponybunny and mcp defaults', () => {
    const files = getOnboardingFiles();
    const ponybunny = files.find((file) => file.name === 'ponybunny.json');
    const mcp = files.find((file) => file.name === 'mcp-config.json');

    const ponybunnyTemplate = ponybunny?.template as Record<string, unknown>;
    const mcpTemplate = mcp?.template as { mcpServers?: Record<string, unknown> };

    expect(ponybunnyTemplate).toBeDefined();
    expect(ponybunnyTemplate.persona).toBeDefined();
    expect(mcpTemplate).toBeDefined();
    expect(mcpTemplate.mcpServers?.fs).toBeDefined();
  });
});
