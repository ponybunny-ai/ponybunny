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
    expect(MCP_CONFIG_TEMPLATE.$schema).toBe('https://ponybunny.dho.ai/schemas/mcp-config.schema.json');
    expect(getPonyBunnyConfigTemplate().$schema).toBe('https://ponybunny.dho.ai/schemas/ponybunny.schema.json');
  });

  it('loads model pricing from llm-config.example.json during init template generation', () => {
    const gpt52Pricing = LLM_CONFIG_TEMPLATE.models['gpt-5.2'].costPer1kTokens;
    expect(gpt52Pricing.input).toBe(0.00175);
    expect(gpt52Pricing.output).toBe(0.014);
  });

  it('does not include local schema files in pb init output', () => {
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
    const template = getPonyBunnyConfigTemplate();
    expect(template.persona.promptOverrides.personalityDescription).toContain('Example:');
    expect(template.persona.promptOverrides.guidelines).toContain('Example:');
  });

  it('keeps all llm providers disabled by default in init template', () => {
    const providers = Object.values(LLM_CONFIG_TEMPLATE.providers);
    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) {
      expect(provider.enabled).toBe(false);
    }
  });
});
