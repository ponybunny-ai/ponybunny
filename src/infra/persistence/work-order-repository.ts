import type {
  IWorkOrderRepository,
  CronJob,
  CronJobRun,
  CronJobRunStatus,
  UpsertCronJobParams,
  ClaimDueCronJobsParams,
  MarkCronJobInFlightParams,
  UpdateCronJobAfterOutcomeParams,
  CreateCronJobRunParams,
} from "./repository-interface.js";
import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';

import type {
  Goal, WorkItem, Run, Artifact, Decision, Escalation, ContextPack,
  GoalRow, WorkItemRow, RunRow, ArtifactRow, DecisionRow, EscalationRow, ContextPackRow,
  GoalStatus, WorkItemStatus, SuccessCriterion, VerificationPlan, ContextSnapshot,
  EscalationContext, DecisionOption
} from '../../work-order/types/index.js';

interface CronJobRow {
  agent_id: string;
  enabled: number;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  schedule_interval_ms: number | null;
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  in_flight_run_key: string | null;
  in_flight_goal_id: string | null;
  in_flight_started_at_ms: number | null;
  claimed_at_ms: number | null;
  claimed_by: string | null;
  claim_expires_at_ms: number | null;
  definition_hash: string;
  backoff_until_ms: number | null;
  failure_count: number;
}

interface CronJobRunRow {
  run_key: string;
  agent_id: string;
  scheduled_for_ms: number;
  created_at_ms: number;
  goal_id: string | null;
  status: CronJobRunStatus;
}

export class WorkOrderDatabase implements IWorkOrderRepository {
  private db: Database.Database;
  private isInitialized = false;
  private static readonly MODULE_DIR = WorkOrderDatabase.resolveModuleDir();

  private static resolveModuleDir(): string {
    const importMetaUrl = WorkOrderDatabase.readImportMetaUrl();
    return importMetaUrl ? dirname(fileURLToPath(importMetaUrl)) : process.cwd();
  }

  private static readImportMetaUrl(): string | undefined {
    try {
      return (0, eval)('import.meta.url') as string;
    } catch {
      return undefined;
    }
  }

  constructor(private dbPath: string) {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const schemaCandidates = [
      join(WorkOrderDatabase.MODULE_DIR, 'schema.sql'),
      join(WorkOrderDatabase.MODULE_DIR, '..', '..', '..', 'dist', 'infra', 'persistence', 'schema.sql'),
      join(process.cwd(), 'dist', 'infra', 'persistence', 'schema.sql'),
      join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql'),
    ];

    const resolvedSchemaPath = schemaCandidates.find((candidatePath) => existsSync(candidatePath));
    if (!resolvedSchemaPath) {
      throw new Error('Could not locate persistence schema.sql in dist/ or src/ paths');
    }

    const schema = readFileSync(resolvedSchemaPath, 'utf-8');
    
    this.db.exec(schema);
    this.isInitialized = true;
  }

  close(): void {
    this.db.close();
  }

  private parseGoalRow(row: GoalRow): Goal {
    return {
      ...row,
      success_criteria: JSON.parse(row.success_criteria),
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      parent_goal_id: row.parent_goal_id || undefined,
      budget_tokens: row.budget_tokens || undefined,
      budget_time_minutes: row.budget_time_minutes || undefined,
      budget_cost_usd: row.budget_cost_usd || undefined,
    };
  }

  private parseWorkItemRow(row: WorkItemRow): WorkItem {
    return {
      ...row,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      blocks: row.blocks ? JSON.parse(row.blocks) : [],
      assigned_agent: row.assigned_agent || undefined,
      verification_plan: row.verification_plan ? JSON.parse(row.verification_plan) : undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
    };
  }

  private parseRunRow(row: RunRow): Run {
    return {
      ...row,
      completed_at: row.completed_at || undefined,
      exit_code: row.exit_code || undefined,
      error_message: row.error_message || undefined,
      error_signature: row.error_signature || undefined,
      time_seconds: row.time_seconds || undefined,
      artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
      execution_log: row.execution_log || undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
    };
  }

  private parseArtifactRow(row: ArtifactRow): Artifact {
    return {
      ...row,
      file_path: row.file_path || undefined,
      content: row.content || undefined,
      blob_path: row.blob_path || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private parseDecisionRow(row: DecisionRow): Decision {
    return {
      ...row,
      options_considered: JSON.parse(row.options_considered),
      confidence_score: row.confidence_score || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private parseEscalationRow(row: EscalationRow): Escalation {
    return {
      ...row,
      resolved_at: row.resolved_at || undefined,
      run_id: row.run_id || undefined,
      context_data: row.context_data ? JSON.parse(row.context_data) : undefined,
      resolution_action: row.resolution_action || undefined,
      resolution_data: row.resolution_data ? JSON.parse(row.resolution_data) : undefined,
      resolver: row.resolver || undefined,
    };
  }

  private parseContextPackRow(row: ContextPackRow): ContextPack {
    return {
      ...row,
      snapshot_data: JSON.parse(row.snapshot_data),
      compressed: Boolean(row.compressed),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private parseCronJobRow(row: CronJobRow): CronJob {
    return {
      agent_id: row.agent_id,
      enabled: Boolean(row.enabled),
      schedule_cron: row.schedule_cron ?? undefined,
      schedule_timezone: row.schedule_timezone ?? undefined,
      schedule_interval_ms: row.schedule_interval_ms ?? undefined,
      next_run_at_ms: row.next_run_at_ms ?? undefined,
      last_run_at_ms: row.last_run_at_ms ?? undefined,
      in_flight_run_key: row.in_flight_run_key ?? undefined,
      in_flight_goal_id: row.in_flight_goal_id ?? undefined,
      in_flight_started_at_ms: row.in_flight_started_at_ms ?? undefined,
      claimed_at_ms: row.claimed_at_ms ?? undefined,
      claimed_by: row.claimed_by ?? undefined,
      claim_expires_at_ms: row.claim_expires_at_ms ?? undefined,
      definition_hash: row.definition_hash,
      backoff_until_ms: row.backoff_until_ms ?? undefined,
      failure_count: row.failure_count,
    };
  }

  private parseCronJobRunRow(row: CronJobRunRow): CronJobRun {
    return {
      run_key: row.run_key,
      agent_id: row.agent_id,
      scheduled_for_ms: row.scheduled_for_ms,
      created_at_ms: row.created_at_ms,
      goal_id: row.goal_id ?? undefined,
      status: row.status,
    };
  }

  createGoal(params: {
    title: string;
    description: string;
    success_criteria: SuccessCriterion[];
    priority?: number;
    budget_tokens?: number;
    budget_time_minutes?: number;
    budget_cost_usd?: number;
    parent_goal_id?: string;
    tags?: string[];
    context?: Record<string, any>;
  }): Goal {
    const now = Date.now();
    const goal: Goal = {
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      title: params.title,
      description: params.description,
      success_criteria: params.success_criteria,
      status: 'queued',
      priority: params.priority ?? 50,
      budget_tokens: params.budget_tokens,
      budget_time_minutes: params.budget_time_minutes,
      budget_cost_usd: params.budget_cost_usd,
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
      parent_goal_id: params.parent_goal_id,
      tags: params.tags,
      context: params.context,
    };

    const stmt = this.db.prepare(`
      INSERT INTO goals (
        id, created_at, updated_at, title, description, success_criteria,
        status, priority, budget_tokens, budget_time_minutes, budget_cost_usd,
        spent_tokens, spent_time_minutes, spent_cost_usd, parent_goal_id, tags, context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      goal.id,
      goal.created_at,
      goal.updated_at,
      goal.title,
      goal.description,
      JSON.stringify(goal.success_criteria),
      goal.status,
      goal.priority,
      goal.budget_tokens ?? null,
      goal.budget_time_minutes ?? null,
      goal.budget_cost_usd ?? null,
      goal.spent_tokens,
      goal.spent_time_minutes,
      goal.spent_cost_usd,
      goal.parent_goal_id ?? null,
      goal.tags ? JSON.stringify(goal.tags) : null,
      goal.context ? JSON.stringify(goal.context) : null
    );

    return goal;
  }

  getGoal(id: string): Goal | undefined {
    const stmt = this.db.prepare('SELECT * FROM goals WHERE id = ?');
    const row = stmt.get(id) as GoalRow | undefined;
    return row ? this.parseGoalRow(row) : undefined;
  }

  updateGoalStatus(id: string, status: GoalStatus): void {
    const stmt = this.db.prepare('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, Date.now(), id);
  }

  updateGoalSpending(id: string, tokens: number, time_minutes: number, cost_usd: number): void {
    const stmt = this.db.prepare(`
      UPDATE goals 
      SET spent_tokens = spent_tokens + ?,
          spent_time_minutes = spent_time_minutes + ?,
          spent_cost_usd = spent_cost_usd + ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(tokens, time_minutes, cost_usd, Date.now(), id);
  }

  listGoals(filters?: { status?: GoalStatus; parent_goal_id?: string }): Goal[] {
    let query = 'SELECT * FROM goals WHERE 1=1';
    const params: any[] = [];

    if (filters?.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.parent_goal_id !== undefined) {
      if (filters.parent_goal_id === null) {
        query += ' AND parent_goal_id IS NULL';
      } else {
        query += ' AND parent_goal_id = ?';
        params.push(filters.parent_goal_id);
      }
    }

    query += ' ORDER BY priority DESC, created_at ASC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as GoalRow[];
    return rows.map(r => this.parseGoalRow(r));
  }

  createWorkItem(params: {
    goal_id: string;
    title: string;
    description: string;
    item_type: WorkItem['item_type'];
    priority?: number;
    dependencies?: string[];
    blocks?: string[];
    estimated_effort?: WorkItem['estimated_effort'];
    verification_plan?: VerificationPlan;
    context?: Record<string, any>;
  }): WorkItem {
    const now = Date.now();
    const workItem: WorkItem = {
      id: randomUUID(),
      created_at: now,
      updated_at: now,
      goal_id: params.goal_id,
      title: params.title,
      description: params.description,
      item_type: params.item_type,
      status: 'queued',
      priority: params.priority ?? 50,
      dependencies: params.dependencies ?? [],
      blocks: params.blocks ?? [],
      estimated_effort: params.estimated_effort ?? 'M',
      retry_count: 0,
      max_retries: 3,
      verification_plan: params.verification_plan,
      verification_status: 'not_started',
      context: params.context,
    };

    const stmt = this.db.prepare(`
      INSERT INTO work_items (
        id, created_at, updated_at, goal_id, title, description, item_type,
        status, priority, dependencies, blocks, estimated_effort,
        retry_count, max_retries, verification_plan, verification_status, context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      workItem.id,
      workItem.created_at,
      workItem.updated_at,
      workItem.goal_id,
      workItem.title,
      workItem.description,
      workItem.item_type,
      workItem.status,
      workItem.priority,
      JSON.stringify(workItem.dependencies),
      JSON.stringify(workItem.blocks),
      workItem.estimated_effort,
      workItem.retry_count,
      workItem.max_retries,
      workItem.verification_plan ? JSON.stringify(workItem.verification_plan) : null,
      workItem.verification_status,
      workItem.context ? JSON.stringify(workItem.context) : null
    );

    return workItem;
  }

  getWorkItem(id: string): WorkItem | undefined {
    const stmt = this.db.prepare('SELECT * FROM work_items WHERE id = ?');
    const row = stmt.get(id) as WorkItemRow | undefined;
    return row ? this.parseWorkItemRow(row) : undefined;
  }

  updateWorkItemStatus(id: string, status: WorkItemStatus): void {
    const stmt = this.db.prepare('UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, Date.now(), id);
  }

  incrementWorkItemRetry(id: string): void {
    const stmt = this.db.prepare('UPDATE work_items SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?');
    stmt.run(Date.now(), id);
  }

  getReadyWorkItems(goal_id?: string): WorkItem[] {
    const query = goal_id
      ? 'SELECT * FROM work_items WHERE status = ? AND goal_id = ? ORDER BY priority DESC, created_at ASC'
      : 'SELECT * FROM work_items WHERE status = ? ORDER BY priority DESC, created_at ASC';

    const params = goal_id ? ['ready', goal_id] : ['ready'];
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as WorkItemRow[];
    return rows.map(r => this.parseWorkItemRow(r));
  }

  getWorkItemsByGoal(goal_id: string): WorkItem[] {
    const stmt = this.db.prepare('SELECT * FROM work_items WHERE goal_id = ? ORDER BY priority DESC, created_at ASC');
    const rows = stmt.all(goal_id) as WorkItemRow[];
    return rows.map(r => this.parseWorkItemRow(r));
  }

  getBlockedWorkItems(blocking_item_id: string): WorkItem[] {
    const blockedItem = this.getWorkItem(blocking_item_id);
    if (!blockedItem || blockedItem.blocks.length === 0) return [];

    const placeholders = blockedItem.blocks.map(() => '?').join(',');
    const stmt = this.db.prepare(`SELECT * FROM work_items WHERE id IN (${placeholders})`);
    const rows = stmt.all(...blockedItem.blocks) as WorkItemRow[];
    return rows.map(r => this.parseWorkItemRow(r));
  }

  updateWorkItemStatusIfDependenciesMet(id: string): void {
    const workItem = this.getWorkItem(id);
    if (!workItem || workItem.status !== 'queued') return;

    const allDependenciesCompleted = workItem.dependencies.every((depId: string) => {
      const dep = this.getWorkItem(depId);
      return dep?.status === 'done';
    });

    if (allDependenciesCompleted) {
      this.updateWorkItemStatus(id, 'ready');
    }
  }

  createRun(params: {
    work_item_id: string;
    goal_id: string;
    agent_type: string;
    run_sequence: number;
    context?: Record<string, any>;
  }): Run {
    const now = Date.now();
    const run: Run = {
      id: randomUUID(),
      created_at: now,
      work_item_id: params.work_item_id,
      goal_id: params.goal_id,
      agent_type: params.agent_type,
      run_sequence: params.run_sequence,
      status: 'running',
      tokens_used: 0,
      cost_usd: 0,
      artifacts: [],
      context: params.context,
    };

    const stmt = this.db.prepare(`
      INSERT INTO runs (
        id, created_at, work_item_id, goal_id, agent_type, run_sequence,
        status, tokens_used, cost_usd, artifacts, context
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.created_at,
      run.work_item_id,
      run.goal_id,
      run.agent_type,
      run.run_sequence,
      run.status,
      run.tokens_used,
      run.cost_usd,
      JSON.stringify(run.artifacts),
      run.context ? JSON.stringify(run.context) : null
    );

    return run;
  }

  completeRun(id: string, params: {
    status: 'success' | 'failure' | 'timeout' | 'aborted';
    exit_code?: number;
    error_message?: string;
    tokens_used: number;
    time_seconds: number;
    cost_usd: number;
    artifacts: string[];
    execution_log?: string;
  }): void {
    const stmt = this.db.prepare(`
      UPDATE runs SET
        completed_at = ?,
        status = ?,
        exit_code = ?,
        error_message = ?,
        error_signature = ?,
        tokens_used = ?,
        time_seconds = ?,
        cost_usd = ?,
        artifacts = ?,
        execution_log = ?
      WHERE id = ?
    `);

    const errorSignature = params.error_message 
      ? this.computeErrorSignature(params.error_message)
      : null;

    stmt.run(
      Date.now(),
      params.status,
      params.exit_code ?? null,
      params.error_message ?? null,
      errorSignature,
      params.tokens_used,
      params.time_seconds,
      params.cost_usd,
      JSON.stringify(params.artifacts),
      params.execution_log ?? null,
      id
    );
  }

  private computeErrorSignature(error_message: string): string {
    const normalized = error_message
      .replace(/\/[^\s]+/g, '<PATH>')
      .replace(/\d+/g, '<NUM>')
      .replace(/0x[0-9a-f]+/gi, '<HEX>')
      .toLowerCase()
      .substring(0, 500);
    
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }

  getRun(id: string): Run | undefined {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?');
    const row = stmt.get(id) as RunRow | undefined;
    return row ? this.parseRunRow(row) : undefined;
  }

  getRunsByWorkItem(work_item_id: string): Run[] {
    const stmt = this.db.prepare('SELECT * FROM runs WHERE work_item_id = ? ORDER BY run_sequence ASC');
    const rows = stmt.all(work_item_id) as RunRow[];
    return rows.map(r => this.parseRunRow(r));
  }

  getRepeatedErrorSignatures(work_item_id: string, threshold = 3): string[] {
    const stmt = this.db.prepare(`
      SELECT error_signature, COUNT(*) as count
      FROM runs
      WHERE work_item_id = ? AND error_signature IS NOT NULL
      GROUP BY error_signature
      HAVING count >= ?
    `);
    
    const rows = stmt.all(work_item_id, threshold) as Array<{ error_signature: string; count: number }>;
    return rows.map(r => r.error_signature);
  }

  createArtifact(params: {
    run_id: string;
    work_item_id: string;
    goal_id: string;
    artifact_type: Artifact['artifact_type'];
    file_path?: string;
    content_hash: string;
    size_bytes: number;
    storage_type: Artifact['storage_type'];
    content?: string;
    blob_path?: string;
    metadata?: Record<string, any>;
  }): Artifact {
    const artifact: Artifact = {
      id: randomUUID(),
      created_at: Date.now(),
      ...params,
    };

    const stmt = this.db.prepare(`
      INSERT INTO artifacts (
        id, created_at, run_id, work_item_id, goal_id, artifact_type,
        file_path, content_hash, size_bytes, storage_type, content, blob_path, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      artifact.id,
      artifact.created_at,
      artifact.run_id,
      artifact.work_item_id,
      artifact.goal_id,
      artifact.artifact_type,
      artifact.file_path ?? null,
      artifact.content_hash,
      artifact.size_bytes,
      artifact.storage_type,
      artifact.content ?? null,
      artifact.blob_path ?? null,
      artifact.metadata ? JSON.stringify(artifact.metadata) : null
    );

    return artifact;
  }

  getArtifact(id: string): Artifact | undefined {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE id = ?');
    const row = stmt.get(id) as ArtifactRow | undefined;
    return row ? this.parseArtifactRow(row) : undefined;
  }

  createDecision(params: {
    run_id: string;
    work_item_id: string;
    goal_id: string;
    decision_type: Decision['decision_type'];
    decision_point: string;
    options_considered: DecisionOption[];
    selected_option: string;
    reasoning: string;
    confidence_score?: number;
    metadata?: Record<string, any>;
  }): Decision {
    const decision: Decision = {
      id: randomUUID(),
      created_at: Date.now(),
      ...params,
    };

    const stmt = this.db.prepare(`
      INSERT INTO decisions (
        id, created_at, run_id, work_item_id, goal_id, decision_type,
        decision_point, options_considered, selected_option, reasoning,
        confidence_score, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decision.id,
      decision.created_at,
      decision.run_id,
      decision.work_item_id,
      decision.goal_id,
      decision.decision_type,
      decision.decision_point,
      JSON.stringify(decision.options_considered),
      decision.selected_option,
      decision.reasoning,
      decision.confidence_score ?? null,
      decision.metadata ? JSON.stringify(decision.metadata) : null
    );

    return decision;
  }

  createEscalation(params: {
    work_item_id: string;
    goal_id: string;
    run_id?: string;
    escalation_type: Escalation['escalation_type'];
    severity: Escalation['severity'];
    title: string;
    description: string;
    context_data?: EscalationContext;
  }): Escalation {
    const escalation: Escalation = {
      id: randomUUID(),
      created_at: Date.now(),
      status: 'open',
      ...params,
    };

    const stmt = this.db.prepare(`
      INSERT INTO escalations (
        id, created_at, work_item_id, goal_id, run_id, escalation_type,
        severity, status, title, description, context_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      escalation.id,
      escalation.created_at,
      escalation.work_item_id,
      escalation.goal_id,
      escalation.run_id ?? null,
      escalation.escalation_type,
      escalation.severity,
      escalation.status,
      escalation.title,
      escalation.description,
      escalation.context_data ? JSON.stringify(escalation.context_data) : null
    );

    return escalation;
  }

  resolveEscalation(id: string, params: {
    resolution_action: Escalation['resolution_action'];
    resolution_data?: Record<string, any>;
    resolver: string;
  }): void {
    const stmt = this.db.prepare(`
      UPDATE escalations SET
        status = 'resolved',
        resolved_at = ?,
        resolution_action = ?,
        resolution_data = ?,
        resolver = ?
      WHERE id = ?
    `);

    stmt.run(
      Date.now(),
      params.resolution_action,
      params.resolution_data ? JSON.stringify(params.resolution_data) : null,
      params.resolver,
      id
    );
  }

  getOpenEscalations(goal_id?: string): Escalation[] {
    const query = goal_id
      ? 'SELECT * FROM escalations WHERE status = ? AND goal_id = ? ORDER BY severity DESC, created_at ASC'
      : 'SELECT * FROM escalations WHERE status = ? ORDER BY severity DESC, created_at ASC';
    
    const params = goal_id ? ['open', goal_id] : ['open'];
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EscalationRow[];
    return rows.map(r => this.parseEscalationRow(r));
  }

  createContextPack(params: {
    goal_id: string;
    pack_type: ContextPack['pack_type'];
    snapshot_data: ContextSnapshot;
    compressed?: boolean;
    metadata?: Record<string, any>;
  }): ContextPack {
    const snapshot_json = JSON.stringify(params.snapshot_data);
    const contextPack: ContextPack = {
      id: randomUUID(),
      created_at: Date.now(),
      goal_id: params.goal_id,
      pack_type: params.pack_type,
      snapshot_data: params.snapshot_data,
      compressed: params.compressed ?? false,
      size_bytes: Buffer.byteLength(snapshot_json, 'utf-8'),
      metadata: params.metadata,
    };

    const stmt = this.db.prepare(`
      INSERT INTO context_packs (
        id, created_at, goal_id, pack_type, snapshot_data, compressed, size_bytes, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      contextPack.id,
      contextPack.created_at,
      contextPack.goal_id,
      contextPack.pack_type,
      snapshot_json,
      contextPack.compressed ? 1 : 0,
      contextPack.size_bytes,
      contextPack.metadata ? JSON.stringify(contextPack.metadata) : null
    );

    return contextPack;
  }

  getLatestContextPack(goal_id: string, pack_type?: ContextPack['pack_type']): ContextPack | undefined {
    const query = pack_type
      ? 'SELECT * FROM context_packs WHERE goal_id = ? AND pack_type = ? ORDER BY created_at DESC LIMIT 1'
      : 'SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1';
    
    const params = pack_type ? [goal_id, pack_type] : [goal_id];
    const stmt = this.db.prepare(query);
    const row = stmt.get(...params) as ContextPackRow | undefined;
    return row ? this.parseContextPackRow(row) : undefined;
  }

  upsertCronJob(params: UpsertCronJobParams): CronJob {
    const schedule = params.schedule;
    const scheduleCron = schedule.kind === 'cron' ? schedule.cron ?? null : null;
    const scheduleIntervalMs = schedule.kind === 'interval' ? schedule.every_ms ?? null : null;

    const stmt = this.db.prepare(`
      INSERT INTO cron_jobs (
        agent_id,
        enabled,
        schedule_cron,
        schedule_timezone,
        schedule_interval_ms,
        definition_hash
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        enabled = excluded.enabled,
        schedule_cron = excluded.schedule_cron,
        schedule_timezone = excluded.schedule_timezone,
        schedule_interval_ms = excluded.schedule_interval_ms,
        definition_hash = excluded.definition_hash
    `);

    stmt.run(
      params.agent_id,
      params.enabled ? 1 : 0,
      scheduleCron,
      schedule.tz ?? null,
      scheduleIntervalMs,
      params.definition_hash
    );

    const row = this.db.prepare('SELECT * FROM cron_jobs WHERE agent_id = ?').get(params.agent_id) as CronJobRow;
    return this.parseCronJobRow(row);
  }

  getCronJob(agent_id: string): CronJob | undefined {
    const stmt = this.db.prepare('SELECT * FROM cron_jobs WHERE agent_id = ?');
    const row = stmt.get(agent_id) as CronJobRow | undefined;
    return row ? this.parseCronJobRow(row) : undefined;
  }

  listCronJobs(): CronJob[] {
    const stmt = this.db.prepare('SELECT * FROM cron_jobs ORDER BY agent_id ASC');
    const rows = stmt.all() as CronJobRow[];
    return rows.map((row) => this.parseCronJobRow(row));
  }

  claimDueCronJobs(params: ClaimDueCronJobsParams): CronJob[] {
    const nowMs = params.now_ms;
    const claimExpiresAt = nowMs + params.claim_ttl_ms;
    const limit = params.limit ?? 1;

    const selectStmt = this.db.prepare(`
      SELECT agent_id
      FROM cron_jobs
      WHERE enabled = 1
        AND next_run_at_ms IS NOT NULL
        AND next_run_at_ms <= ?
        AND (backoff_until_ms IS NULL OR backoff_until_ms <= ?)
        AND in_flight_run_key IS NULL
        AND (claim_expires_at_ms IS NULL OR claim_expires_at_ms <= ?)
      ORDER BY next_run_at_ms ASC
      LIMIT ?
    `);

    const claimStmt = this.db.prepare(`
      UPDATE cron_jobs
      SET claimed_at_ms = ?,
          claimed_by = ?,
          claim_expires_at_ms = ?
      WHERE agent_id = ?
        AND enabled = 1
        AND next_run_at_ms IS NOT NULL
        AND next_run_at_ms <= ?
        AND (backoff_until_ms IS NULL OR backoff_until_ms <= ?)
        AND in_flight_run_key IS NULL
        AND (claim_expires_at_ms IS NULL OR claim_expires_at_ms <= ?)
    `);

    const loadStmt = this.db.prepare('SELECT * FROM cron_jobs WHERE agent_id = ?');

    const claimTransaction = this.db.transaction(() => {
      const candidates = selectStmt.all(nowMs, nowMs, nowMs, limit) as Array<{ agent_id: string }>;
      const claimed: CronJob[] = [];

      for (const candidate of candidates) {
        const result = claimStmt.run(
          nowMs,
          params.claimed_by,
          claimExpiresAt,
          candidate.agent_id,
          nowMs,
          nowMs,
          nowMs
        );

        if (result.changes > 0) {
          const row = loadStmt.get(candidate.agent_id) as CronJobRow;
          claimed.push(this.parseCronJobRow(row));
        }
      }

      return claimed;
    });

    return claimTransaction();
  }

  markCronJobInFlight(params: MarkCronJobInFlightParams): void {
    const stmt = this.db.prepare(`
      UPDATE cron_jobs SET
        in_flight_run_key = ?,
        in_flight_goal_id = ?,
        in_flight_started_at_ms = ?,
        last_run_at_ms = ?,
        claimed_at_ms = NULL,
        claimed_by = NULL,
        claim_expires_at_ms = NULL
      WHERE agent_id = ?
    `);

    stmt.run(
      params.run_key,
      params.goal_id ?? null,
      params.started_at_ms,
      params.last_run_at_ms,
      params.agent_id
    );
  }

  updateCronJobAfterOutcome(params: UpdateCronJobAfterOutcomeParams): void {
    const stmt = this.db.prepare(`
      UPDATE cron_jobs SET
        next_run_at_ms = ?,
        backoff_until_ms = ?,
        failure_count = ?,
        in_flight_run_key = NULL,
        in_flight_goal_id = NULL,
        in_flight_started_at_ms = NULL,
        claimed_at_ms = NULL,
        claimed_by = NULL,
        claim_expires_at_ms = NULL
      WHERE agent_id = ?
    `);

    stmt.run(
      params.next_run_at_ms,
      params.backoff_until_ms ?? null,
      params.failure_count ?? 0,
      params.agent_id
    );
  }

  getOrCreateCronJobRun(params: CreateCronJobRunParams): CronJobRun {
    const runKey = randomUUID();

    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO cron_job_runs (
        run_key, agent_id, scheduled_for_ms, created_at_ms, goal_id, status
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      runKey,
      params.agent_id,
      params.scheduled_for_ms,
      params.created_at_ms,
      params.goal_id ?? null,
      params.status
    );

    const selectStmt = this.db.prepare(`
      SELECT * FROM cron_job_runs
      WHERE agent_id = ? AND scheduled_for_ms = ?
    `);
    const row = selectStmt.get(params.agent_id, params.scheduled_for_ms) as CronJobRunRow;
    return this.parseCronJobRunRow(row);
  }

  linkCronJobRunToGoal(run_key: string, goal_id: string): void {
    const stmt = this.db.prepare(`
      UPDATE cron_job_runs SET goal_id = ?
      WHERE run_key = ?
    `);

    stmt.run(goal_id, run_key);
  }

  updateCronJobRunStatus(run_key: string, status: CronJobRunStatus): void {
    const stmt = this.db.prepare(`
      UPDATE cron_job_runs SET status = ?
      WHERE run_key = ?
    `);

    stmt.run(status, run_key);
  }
}
