import type { AgentACheckpoint, AgentASourceConfig, AgentAStoreRequest, AgentAStoreResult } from './types.js';
import type { MCPToolCallResult } from '../../../infra/mcp/client/types.js';
import { MCPToolExecutor, parseJsonResult } from './mcp-tool-executor.js';
import type { IMCPToolExecutor } from './mcp-tool-executor.js';

const CREATE_SOURCES_TABLE = `create table if not exists agent_a_sources (
  id bigserial primary key,
  platform text not null check (platform in ('reddit','github','forum_web')),
  source_id text not null,
  enabled boolean not null default true,
  poll_interval_seconds int not null default 600,
  max_items int not null default 50,
  priority int not null default 50,
  created_at timestamptz not null default now()
)`;

const CREATE_SOURCES_INDEX = `create unique index if not exists idx_agent_a_sources_unique
on agent_a_sources(platform, source_id)`;

const CREATE_CHECKPOINTS_TABLE = `create table if not exists agent_a_checkpoints (
  platform text not null,
  source_id text not null,
  cursor text,
  last_seen_at timestamptz,
  backoff_until timestamptz,
  failure_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (platform, source_id)
)`;

const CREATE_DEDUPE_TABLE = `create table if not exists agent_a_dedupe (
  key text primary key,
  created_at timestamptz not null default now()
)`;

const CREATE_OBSERVATIONS_TABLE = `create table if not exists agent_a_observations (
  id bigserial primary key,
  platform text not null,
  source_id text not null,
  permalink text not null,
  author text,
  created_at timestamptz,
  label text not null,
  signal_markers jsonb not null default '[]'::jsonb,
  problem_raw_text text not null,
  surrounding_context text not null default '',
  role_guess text not null default 'unknown',
  role_confidence real not null default 0.1,
  raw_text_hash text not null,
  ingest_run_id text not null,
  inserted_at timestamptz not null default now()
)`;

const CREATE_OBS_PERMALINK_INDEX = `create unique index if not exists idx_agent_a_obs_permalink
on agent_a_observations(permalink)`;

const CREATE_OBS_HASH_INDEX = `create index if not exists idx_agent_a_obs_hash
on agent_a_observations(raw_text_hash)`;

const CREATE_RUNS_TABLE = `create table if not exists agent_a_runs (
  run_id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_processed int not null default 0,
  items_fetched int not null default 0,
  items_scanned int not null default 0,
  items_stored int not null default 0,
  errors int not null default 0,
  meta jsonb not null default '{}'::jsonb
)`;

const INSERT_RUN = `insert into agent_a_runs(run_id) values ($1)`;

const UPDATE_RUN = `update agent_a_runs
set finished_at = now(),
    sources_processed = $2,
    items_fetched = $3,
    items_scanned = $4,
    items_stored = $5,
    errors = $6
where run_id = $1`;

const SELECT_SOURCES = `select id, platform, source_id, enabled, poll_interval_seconds, max_items, priority
from agent_a_sources
where enabled = true
order by priority asc
limit $1`;

const SELECT_CHECKPOINT = `select platform, source_id, cursor, last_seen_at, backoff_until, failure_count, updated_at
from agent_a_checkpoints
where platform = $1 and source_id = $2`;

const UPSERT_CHECKPOINT = `insert into agent_a_checkpoints(platform, source_id, cursor, last_seen_at, backoff_until, failure_count, updated_at)
values ($1, $2, $3, $4, $5, $6, now())
on conflict (platform, source_id)
do update set cursor = excluded.cursor,
              last_seen_at = excluded.last_seen_at,
              backoff_until = excluded.backoff_until,
              failure_count = excluded.failure_count,
              updated_at = now()`;

const SELECT_DEDUPE = `select key from agent_a_dedupe where key = $1`;

const INSERT_DEDUPE = `insert into agent_a_dedupe(key) values ($1) on conflict do nothing`;

const SELECT_OBSERVATION_BY_PERMALINK = `select id from agent_a_observations where permalink = $1`;

const SELECT_OBSERVATION_BY_HASH = `select id from agent_a_observations where raw_text_hash = $1`;

const INSERT_OBSERVATION = `insert into agent_a_observations(
  platform, source_id, permalink, author, created_at, label, signal_markers,
  problem_raw_text, surrounding_context, role_guess, role_confidence, raw_text_hash, ingest_run_id
) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)
returning id`;

const EXECUTE_ALLOWLIST = new Set([
  CREATE_SOURCES_TABLE,
  CREATE_SOURCES_INDEX,
  CREATE_CHECKPOINTS_TABLE,
  CREATE_DEDUPE_TABLE,
  CREATE_OBSERVATIONS_TABLE,
  CREATE_OBS_PERMALINK_INDEX,
  CREATE_OBS_HASH_INDEX,
  CREATE_RUNS_TABLE,
  INSERT_RUN,
  UPDATE_RUN,
  UPSERT_CHECKPOINT,
  INSERT_DEDUPE,
  INSERT_OBSERVATION,
]);

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

const NORMALIZED_EXECUTE_ALLOWLIST = new Set(
  Array.from(EXECUTE_ALLOWLIST).map(statement => normalizeSql(statement))
);

export function isApprovedExecuteSql(sql: string): boolean {
  return NORMALIZED_EXECUTE_ALLOWLIST.has(normalizeSql(sql));
}

function ensureApprovedExecute(sql: string): void {
  if (!isApprovedExecuteSql(sql)) {
    throw new Error('SQL statement is not approved for pg.execute');
  }
}

function parseRows<T>(result: MCPToolCallResult): T[] {
  const parsed = parseJsonResult<unknown>(result);
  if (Array.isArray(parsed)) {
    return parsed as T[];
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as { rows?: T[]; data?: T[] };
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.data)) return obj.data;
  }
  return [];
}

export class AgentAStorage {
  constructor(private executor: IMCPToolExecutor = new MCPToolExecutor()) {}

  async ensureSchema(): Promise<void> {
    await this.execute(CREATE_SOURCES_TABLE);
    await this.execute(CREATE_SOURCES_INDEX);
    await this.execute(CREATE_CHECKPOINTS_TABLE);
    await this.execute(CREATE_DEDUPE_TABLE);
    await this.execute(CREATE_OBSERVATIONS_TABLE);
    await this.execute(CREATE_OBS_PERMALINK_INDEX);
    await this.execute(CREATE_OBS_HASH_INDEX);
    await this.execute(CREATE_RUNS_TABLE);
  }

  async listSources(limit: number): Promise<AgentASourceConfig[]> {
    const result = await this.executor.callTool('pg', 'pg.select', {
      sql: SELECT_SOURCES,
      params: [limit],
    });
    return parseRows<AgentASourceConfig>(result);
  }

  async getCheckpoint(platform: string, sourceId: string): Promise<AgentACheckpoint | null> {
    const result = await this.executor.callTool('pg', 'pg.select', {
      sql: SELECT_CHECKPOINT,
      params: [platform, sourceId],
    });
    const rows = parseRows<AgentACheckpoint>(result);
    return rows[0] ?? null;
  }

  async upsertCheckpoint(checkpoint: AgentACheckpoint): Promise<void> {
    await this.execute(UPSERT_CHECKPOINT, [
      checkpoint.platform,
      checkpoint.source_id,
      checkpoint.cursor,
      checkpoint.last_seen_at,
      checkpoint.backoff_until,
      checkpoint.failure_count,
    ]);
  }

  async recordRunStart(runId: string): Promise<void> {
    await this.execute(INSERT_RUN, [runId]);
  }

  async recordRunFinish(
    runId: string,
    metrics: { sourcesProcessed: number; itemsFetched: number; itemsScanned: number; itemsStored: number; errors: number }
  ): Promise<void> {
    await this.execute(UPDATE_RUN, [
      runId,
      metrics.sourcesProcessed,
      metrics.itemsFetched,
      metrics.itemsScanned,
      metrics.itemsStored,
      metrics.errors,
    ]);
  }

  async isDeduped(permalink: string, rawTextHash: string): Promise<boolean> {
    const permalinkResult = await this.executor.callTool('pg', 'pg.select', {
      sql: SELECT_OBSERVATION_BY_PERMALINK,
      params: [permalink],
    });
    const permalinkRows = parseRows<{ id: string }>(permalinkResult);
    if (permalinkRows.length > 0) return true;

    const hashResult = await this.executor.callTool('pg', 'pg.select', {
      sql: SELECT_OBSERVATION_BY_HASH,
      params: [rawTextHash],
    });
    const hashRows = parseRows<{ id: string }>(hashResult);
    return hashRows.length > 0;
  }

  async recordDedupeKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.execute(INSERT_DEDUPE, [key]);
    }
  }

  async storeRecord(request: AgentAStoreRequest): Promise<AgentAStoreResult> {
    const deduped = await this.isDeduped(request.permalink, request.raw_text_hash);
    if (deduped) {
      return { stored: false, record_id: null, deduped: true };
    }

    const result = await this.execute(INSERT_OBSERVATION, [
      request.platform,
      request.source_id,
      request.permalink,
      request.author,
      request.created_at,
      request.label,
      JSON.stringify(request.signal_markers),
      request.problem_raw_text,
      request.surrounding_context,
      request.role_guess,
      request.role_confidence,
      request.raw_text_hash,
      request.ingest_run_id,
    ]);

    const rows = parseRows<{ id: string }>(result);
    const recordId = rows[0]?.id ?? null;
    await this.recordDedupeKeys([request.permalink, request.raw_text_hash]);

    return { stored: true, record_id: recordId, deduped: false };
  }

  private async execute(sql: string, params: unknown[] = []): Promise<MCPToolCallResult> {
    ensureApprovedExecute(sql);
    return this.executor.callTool('pg', 'pg.execute', { sql, params });
  }
}
