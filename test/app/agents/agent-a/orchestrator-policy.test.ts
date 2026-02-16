import fs from 'fs';
import path from 'path';
import { DEFAULT_AGENT_A_CONFIG } from '../../../../src/app/agents/agent-a/limits.js';
import { isAllowedLLMTool, isAllowedMCPTool, isForbiddenTool } from '../../../../src/app/agents/agent-a/tool-allowlist.js';

const policyPath = path.resolve(process.cwd(), 'docs/agents/agent-a.orchestrator-policy.yaml');

describe('Agent A orchestrator policy', () => {
  const content = fs.readFileSync(policyPath, 'utf-8');

  test('includes required tool allowlist entries', () => {
    const llmTools = ['llm.extract_json', 'llm.classify'];
    const mcpTools: Record<string, string[]> = {
      pg: ['pg.select', 'pg.insert', 'pg.execute'],
      reddit: ['reddit.list_new_posts', 'reddit.list_new_comments'],
      github: ['github.list_issues', 'github.list_issue_comments'],
      playwright: ['playwright.navigate', 'playwright.get_content', 'playwright.query_selector_all'],
    };

    for (const tool of llmTools) {
      expect(content).toContain(`- ${tool}`);
      expect(isAllowedLLMTool(tool)).toBe(true);
    }

    for (const [server, tools] of Object.entries(mcpTools)) {
      expect(content).toContain(`  ${server}:`);
      for (const tool of tools) {
        expect(content).toContain(`- ${tool}`);
        expect(isAllowedMCPTool(server, tool)).toBe(true);
      }
    }
  });

  test('includes forbidden patterns matching runtime rules', () => {
    const forbidden = ['.post', '.reply', '.send_message', 'create_', 'update_', 'delete_'];
    for (const pattern of forbidden) {
      expect(content).toContain(pattern);
      expect(isForbiddenTool(pattern)).toBe(true);
    }
  });

  test('matches rate limits and circuit breaker thresholds', () => {
    const limits = DEFAULT_AGENT_A_CONFIG;

    expect(content).toContain(`failure_threshold: ${limits.circuit_breaker_failure_threshold}`);
    expect(content).toContain(`backoff_hours: ${limits.circuit_breaker_backoff_hours}`);

    expect(content).toContain(`max_requests_per_minute: ${limits.rate_limits.reddit.max_requests_per_minute}`);
    const redditBackoff = limits.rate_limits.reddit.backoff_on_429_seconds ?? [];
    expect(content).toContain(`backoff_on_429_seconds: [${redditBackoff.join(', ')}]`);

    expect(content).toContain(`max_requests_per_minute: ${limits.rate_limits.github.max_requests_per_minute}`);
    const githubBackoff = limits.rate_limits.github.backoff_on_403_seconds ?? [];
    expect(content).toContain(`backoff_on_403_seconds: [${githubBackoff.join(', ')}]`);

    expect(content).toContain(`max_requests_per_minute: ${limits.rate_limits.forum_web.max_requests_per_minute}`);
    const forumBackoff = limits.rate_limits.forum_web.backoff_on_403_429_seconds ?? [];
    expect(content).toContain(`backoff_on_403_429_seconds: [${forumBackoff.join(', ')}]`);
  });
});
