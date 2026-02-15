import { AgentAStorage, isApprovedExecuteSql } from '../../../../src/app/agents/agent-a/storage.js';
import type { MCPToolCallResult } from '../../../../src/infra/mcp/client/types.js';

class FakeExecutor {
  public calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
  private selectCount = 0;

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    this.calls.push({ server: serverName, tool: toolName, args });

    if (toolName === 'pg.select') {
      const sql = String(args.sql || '');
      if (sql.includes('agent_a_observations')) {
        this.selectCount += 1;
      }
      if (sql.includes('agent_a_observations') && this.selectCount >= 3) {
        return { content: [{ type: 'text', text: JSON.stringify({ rows: [{ id: '1' }] }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ rows: [] }) }] };
    }

    if (toolName === 'pg.execute') {
      return { content: [{ type: 'text', text: JSON.stringify({ rows: [{ id: '1' }] }) }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify({ rows: [] }) }] };
  }
}

describe('AgentAStorage', () => {
  test('SQL whitelist rejects unknown statements', () => {
    expect(isApprovedExecuteSql('select 1')).toBe(false);
  });

  test('SQL whitelist accepts approved DDL', () => {
    const ddl = `create table if not exists agent_a_sources (
  id bigserial primary key,
  platform text not null check (platform in ('reddit','github','forum_web')),
  source_id text not null,
  enabled boolean not null default true,
  poll_interval_seconds int not null default 600,
  max_items int not null default 50,
  priority int not null default 50,
  created_at timestamptz not null default now()
)`;
    expect(isApprovedExecuteSql(ddl)).toBe(true);
  });

  test('storeRecord dedupes on second insert', async () => {
    const executor = new FakeExecutor();
    const storage = new AgentAStorage(executor);

    const first = await storage.storeRecord({
      platform: 'reddit',
      source_id: 'SaaS',
      permalink: 'https://example.com/1',
      author: 'alice',
      created_at: new Date().toISOString(),
      problem_raw_text: 'Problem',
      surrounding_context: 'Context',
      label: 'problem',
      signal_markers: ['Problem'],
      role_guess: 'unknown',
      role_confidence: 0.1,
      raw_text_hash: 'hash1',
      ingest_run_id: 'run-1',
    });

    const second = await storage.storeRecord({
      platform: 'reddit',
      source_id: 'SaaS',
      permalink: 'https://example.com/1',
      author: 'alice',
      created_at: new Date().toISOString(),
      problem_raw_text: 'Problem',
      surrounding_context: 'Context',
      label: 'problem',
      signal_markers: ['Problem'],
      role_guess: 'unknown',
      role_confidence: 0.1,
      raw_text_hash: 'hash1',
      ingest_run_id: 'run-1',
    });

    expect(first.stored).toBe(true);
    expect(second.deduped).toBe(true);
  });
});
