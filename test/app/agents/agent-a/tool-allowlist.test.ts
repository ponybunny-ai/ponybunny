import { assertAllowedTool, isAllowedMCPTool, isAllowedLLMTool, isForbiddenTool } from '../../../../src/app/agents/agent-a/tool-allowlist.js';

describe('Agent A tool allowlist', () => {
  test('allows approved LLM tools', () => {
    expect(isAllowedLLMTool('llm.classify')).toBe(true);
    expect(isAllowedLLMTool('llm.extract_json')).toBe(true);
  });

  test('denies forbidden tools', () => {
    expect(isForbiddenTool('reddit.post')).toBe(true);
    expect(isForbiddenTool('github.create_issue')).toBe(true);
  });

  test('allows approved MCP tools', () => {
    expect(isAllowedMCPTool('reddit', 'reddit.list_new_posts')).toBe(true);
    expect(isAllowedMCPTool('postgres', 'pg.select')).toBe(true);
  });

  test('assertAllowedTool throws for forbidden tool', () => {
    expect(() => assertAllowedTool('reddit', 'reddit.post')).toThrow();
  });
});
