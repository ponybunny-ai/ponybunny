/**
 * Audit Log Domain Types
 *
 * Provides comprehensive audit logging for all system operations including:
 * - State changes (goals, work items, runs)
 * - Tool invocations and blocks
 * - Authentication events
 * - Permission requests and grants
 * - Escalation lifecycle
 */

// ============================================================================
// Audit Action Types
// ============================================================================

export type AuditAction =
  // Goal lifecycle
  | 'goal.created'
  | 'goal.status_changed'
  | 'goal.cancelled'
  | 'goal.budget_updated'
  // Work item lifecycle
  | 'work_item.created'
  | 'work_item.status_changed'
  | 'work_item.retry'
  | 'work_item.dependency_updated'
  // Run lifecycle
  | 'run.started'
  | 'run.completed'
  | 'run.aborted'
  // Tool operations
  | 'tool.invoked'
  | 'tool.completed'
  | 'tool.blocked'
  | 'tool.failed'
  // Escalation lifecycle
  | 'escalation.created'
  | 'escalation.acknowledged'
  | 'escalation.resolved'
  | 'escalation.dismissed'
  // Session lifecycle
  | 'session.created'
  | 'session.ended'
  | 'session.expired'
  // Authentication events
  | 'auth.challenge_issued'
  | 'auth.authenticated'
  | 'auth.failed'
  | 'auth.token_created'
  | 'auth.token_revoked'
  // Permission events
  | 'permission.requested'
  | 'permission.granted'
  | 'permission.denied'
  | 'permission.expired'
  // Artifact events
  | 'artifact.created'
  | 'artifact.deleted'
  // Decision events
  | 'decision.recorded';

// ============================================================================
// Audit Entity Types
// ============================================================================

export type AuditEntityType =
  | 'goal'
  | 'work_item'
  | 'run'
  | 'artifact'
  | 'decision'
  | 'escalation'
  | 'session'
  | 'tool'
  | 'auth'
  | 'permission';

// ============================================================================
// Audit Log Interface
// ============================================================================

export interface IAuditLog {
  id: string;
  timestamp: number;

  // Actor information
  actor: string;           // publicKey, 'system', 'daemon', or agent identifier
  actor_type: ActorType;

  // Action details
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;

  // Related entities for easier querying
  goal_id?: string;
  work_item_id?: string;
  run_id?: string;
  session_id?: string;

  // Change tracking
  old_value?: unknown;
  new_value?: unknown;

  // Additional context
  metadata?: Record<string, unknown>;

  // Request context
  ip_address?: string;
  user_agent?: string;
}

export type ActorType =
  | 'user'      // Human user via CLI/TUI
  | 'system'    // Internal system operations
  | 'daemon'    // Autonomy daemon
  | 'agent'     // AI agent during execution
  | 'scheduler' // Scheduler operations
  | 'gateway';  // Gateway operations

// ============================================================================
// Database Row Type
// ============================================================================

export interface AuditLogRow {
  id: string;
  timestamp: number;
  actor: string;
  actor_type: ActorType;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string;
  goal_id: string | null;
  work_item_id: string | null;
  run_id: string | null;
  session_id: string | null;
  old_value: string | null;  // JSON
  new_value: string | null;  // JSON
  metadata: string | null;   // JSON
  ip_address: string | null;
  user_agent: string | null;
}

// ============================================================================
// Repository Interface
// ============================================================================

export interface IAuditLogRepository {
  /**
   * Log an audit entry
   */
  log(entry: Omit<IAuditLog, 'id' | 'timestamp'>): IAuditLog;

  /**
   * Log multiple entries in a batch (for performance)
   */
  logBatch(entries: Omit<IAuditLog, 'id' | 'timestamp'>[]): IAuditLog[];

  /**
   * Get audit log by ID
   */
  getById(id: string): IAuditLog | undefined;

  /**
   * Get audit logs by entity ID
   */
  getByEntityId(entityType: AuditEntityType, entityId: string, limit?: number): IAuditLog[];

  /**
   * Get audit logs by goal ID (includes all related entities)
   */
  getByGoalId(goalId: string, limit?: number): IAuditLog[];

  /**
   * Get audit logs by actor
   */
  getByActor(actor: string, limit?: number): IAuditLog[];

  /**
   * Get audit logs by action type
   */
  getByAction(action: AuditAction, limit?: number): IAuditLog[];

  /**
   * Get audit logs by action prefix (e.g., 'goal.' for all goal actions)
   */
  getByActionPrefix(prefix: string, limit?: number): IAuditLog[];

  /**
   * Get audit logs within a time range
   */
  getByTimeRange(from: number, to: number, limit?: number): IAuditLog[];

  /**
   * Get recent audit logs
   */
  getRecent(limit?: number): IAuditLog[];

  /**
   * Prune old audit logs
   * @param olderThanMs Delete logs older than this duration in milliseconds
   * @returns Number of deleted entries
   */
  prune(olderThanMs: number): number;

  /**
   * Get count of audit logs (for monitoring)
   */
  count(): number;
}

// ============================================================================
// Audit Service Interface
// ============================================================================

export interface IAuditService {
  // Goal operations
  logGoalCreated(goalId: string, actor: string, actorType: ActorType, data: Record<string, unknown>): void;
  logGoalStatusChanged(goalId: string, actor: string, actorType: ActorType, oldStatus: string, newStatus: string): void;

  // Work item operations
  logWorkItemCreated(workItemId: string, goalId: string, actor: string, actorType: ActorType, data: Record<string, unknown>): void;
  logWorkItemStatusChanged(workItemId: string, goalId: string, actor: string, actorType: ActorType, oldStatus: string, newStatus: string): void;

  // Run operations
  logRunStarted(runId: string, workItemId: string, goalId: string, agentType: string): void;
  logRunCompleted(runId: string, workItemId: string, goalId: string, status: string, metadata?: Record<string, unknown>): void;

  // Tool operations
  logToolInvoked(toolName: string, runId: string, workItemId: string, goalId: string, args?: Record<string, unknown>): void;
  logToolCompleted(toolName: string, runId: string, workItemId: string, goalId: string, result?: unknown): void;
  logToolBlocked(toolName: string, runId: string, workItemId: string, goalId: string, reason: string): void;

  // Auth operations
  logAuthEvent(action: 'auth.challenge_issued' | 'auth.authenticated' | 'auth.failed', actor: string, metadata?: Record<string, unknown>): void;

  // Escalation operations
  logEscalationCreated(escalationId: string, workItemId: string, goalId: string, type: string, severity: string): void;
  logEscalationResolved(escalationId: string, workItemId: string, goalId: string, resolver: string, action: string): void;

  // Query operations
  getLogsForGoal(goalId: string, limit?: number): IAuditLog[];
  getLogsForEntity(entityType: AuditEntityType, entityId: string, limit?: number): IAuditLog[];
  getRecentLogs(limit?: number): IAuditLog[];
}

// ============================================================================
// Audit Query Filters
// ============================================================================

export interface AuditLogFilter {
  actor?: string;
  actor_type?: ActorType;
  action?: AuditAction;
  action_prefix?: string;
  entity_type?: AuditEntityType;
  entity_id?: string;
  goal_id?: string;
  work_item_id?: string;
  run_id?: string;
  session_id?: string;
  from_timestamp?: number;
  to_timestamp?: number;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Audit Statistics
// ============================================================================

export interface AuditStatistics {
  total_entries: number;
  entries_by_action: Record<string, number>;
  entries_by_entity_type: Record<string, number>;
  entries_by_actor_type: Record<string, number>;
  oldest_entry_timestamp?: number;
  newest_entry_timestamp?: number;
}
