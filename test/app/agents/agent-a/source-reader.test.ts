import { AgentASourceReader } from '../../../../src/app/agents/agent-a/source-reader.js';
import type { MCPToolCallResult } from '../../../../src/infra/mcp/client/types.js';
import type { AgentALimitsConfig } from '../../../../src/app/agents/agent-a/types.js';

class FakeExecutor {
  async callTool(_server: string, tool: string, _args: Record<string, unknown>): Promise<MCPToolCallResult> {
    if (tool === 'reddit.list_new_posts') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ posts: [{ id: '1', title: 'hello world', selftext: 'long text here', permalink: '/r/test/1' }] }),
        }],
      };
    }
    if (tool === 'reddit.list_new_comments') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ comments: [{ id: 'c1', body: 'comment body', permalink: '/r/test/c1' }] }),
        }],
      };
    }
    if (tool === 'playwright.get_content') {
      return { content: [{ type: 'text', text: 'forum content' }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({}) }] };
  }
}

describe('AgentASourceReader', () => {
  test('truncates raw_text to limits', async () => {
    const limits: AgentALimitsConfig = {
      raw_text_max_chars: 5,
      problem_raw_text_max_chars: 10,
      surrounding_context_max_chars: 10,
      signal_markers_max_items: 3,
    };

    const reader = new AgentASourceReader(new FakeExecutor(), limits);
    const result = await reader.readStream({
      platform: 'reddit',
      source_id: 'test',
      cursor: null,
      time_window: '6h',
      max_items: 2,
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].raw_text.length).toBeLessThanOrEqual(5);
    expect(result.items[0].metadata.truncated).toBe(true);
  });
});
