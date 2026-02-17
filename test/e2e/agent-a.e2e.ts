import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';

import {
  AgentAService,
  AgentAStorage,
  AgentASourceReader,
  DEFAULT_AGENT_A_CONFIG,
} from '../../src/app/agents/agent-a/index.js';
import type { AgentAPlatform } from '../../src/app/agents/agent-a/types.js';
import { MCPToolExecutor, parseJsonResult } from '../../src/app/agents/agent-a/mcp-tool-executor.js';
import { initializeMCPConnectionManager, shutdownMCPConnectionManager } from '../../src/infra/mcp/index.js';

const PG_CONNECTION_STRING = 'postgresql://pony:pony_pass@localhost:15432/ponybunny';
const PLAYWRIGHT_URL = 'http://localhost:17777';

function createTempConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ponybunny-agent-a-e2e-'));
}

function writeMcpConfig(dir: string): void {
  const configPath = path.join(dir, 'mcp-config.json');
  const config = {
    mcpServers: {
      pg: {
        enabled: true,
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', PG_CONNECTION_STRING],
        allowedTools: ['pg.select', 'pg.insert', 'pg.execute'],
      },
      playwright: {
        enabled: true,
        transport: 'http' as const,
        url: PLAYWRIGHT_URL,
        allowedTools: ['playwright.navigate', 'playwright.get_content', 'playwright.query_selector_all'],
        autoReconnect: true,
        timeout: 60000,
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function startLocalForumServer(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine local server port'));
        return;
      }

      const dockerHost = process.env.PONYBUNNY_E2E_HOST ?? 'host.docker.internal';
      const url = `http://${dockerHost}:${address.port}/`;
      resolve({
        url,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

async function executePg(sql: string, params: unknown[] = []): Promise<void> {
  const executor = new MCPToolExecutor();
  await executor.callTool('pg', 'pg.execute', { sql, params });
}

async function selectPg<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const executor = new MCPToolExecutor();
  const result = await executor.callTool('pg', 'pg.select', { sql, params });
  const parsed = parseJsonResult<unknown>(result);
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === 'object') {
    const record = parsed as { rows?: T[]; data?: T[] };
    if (Array.isArray(record.rows)) return record.rows;
    if (Array.isArray(record.data)) return record.data;
  }
  return [];
}

function createLlmHelperStub() {
  return {
    async detectProblemSignal(request: { raw_text: string; platform: AgentAPlatform }) {
      return {
        has_problem_signal: request.raw_text.length > 0,
        signal_markers: [request.raw_text.split('\n')[0].slice(0, 80)],
        label: 'problem',
        confidence: 0.55,
      };
    },
    async extractProblemBlock(request: { raw_text: string; window_chars: number; platform: AgentAPlatform }) {
      return {
        problem_raw_text: request.raw_text.slice(0, request.window_chars),
        surrounding_context: '',
      };
    },
    async guessAuthorRole() {
      return { role_guess: 'unknown', confidence: 0.1 };
    },
  };
}

async function main() {
  console.log('=== Agent A E2E (MCP + Postgres) ===');

  const configDir = createTempConfigDir();
  writeMcpConfig(configDir);
  process.env.PONYBUNNY_CONFIG_DIR = configDir;

  const forumHtml = `
    <html>
      <body>
        <h1>Help needed</h1>
        <p>I keep getting a 502 when deploying my app, and I cannot figure out why.</p>
      </body>
    </html>
  `;

  const server = await startLocalForumServer(forumHtml);
  const now = new Date();
  const runId = `agent-a-e2e-${now.getTime()}`;

  try {
    await initializeMCPConnectionManager();

    const storage = new AgentAStorage();
    await storage.ensureSchema();

    await executePg(
      `insert into agent_a_sources(platform, source_id, poll_interval_seconds, max_items, priority)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      ['forum_web', server.url, 1, 5, 1]
    );

    const sourceReader = new AgentASourceReader(undefined, DEFAULT_AGENT_A_CONFIG.limits);
    const llmHelper = createLlmHelperStub();
    const service = new AgentAService({ storage, sourceReader, llmHelper });

    const result = await service.tick({
      run_id: runId,
      now: now.toISOString(),
      max_sources_per_tick: 1,
      max_items_per_source: 5,
      default_time_window: '6h',
    });

    if (result.items_stored < 1) {
      throw new Error('Expected at least one stored observation');
    }

    const observations = await selectPg<{ problem_raw_text: string }>(
      'select problem_raw_text from agent_a_observations where ingest_run_id = $1 order by inserted_at desc limit 1',
      [runId]
    );

    if (observations.length === 0) {
      throw new Error('Expected stored observation for the run');
    }

    const storedText = observations[0].problem_raw_text || '';
    if (!storedText.toLowerCase().includes('502')) {
      throw new Error('Stored observation did not include expected content');
    }

    console.log('✅ Agent A E2E succeeded');
  } finally {
    try {
      await executePg('delete from agent_a_observations where ingest_run_id = $1', [runId]);
      await executePg('delete from agent_a_runs where run_id = $1', [runId]);
      await executePg('delete from agent_a_checkpoints');
      await executePg('delete from agent_a_dedupe');
      await executePg('delete from agent_a_sources');
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }

    await shutdownMCPConnectionManager();
    await server.close();
    delete process.env.PONYBUNNY_CONFIG_DIR;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('E2E failed:', error);
  process.exit(1);
});
