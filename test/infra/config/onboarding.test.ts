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
});
