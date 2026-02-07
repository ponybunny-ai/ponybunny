import type {
  IAuditLog,
  IAuditLogRepository,
  IAuditService,
  AuditAction,
  AuditEntityType,
  ActorType,
} from '../../domain/audit/types.js';

/**
 * Audit Service
 *
 * Provides a high-level API for logging audit events throughout the system.
 * Wraps the repository with convenient methods for common audit scenarios.
 *
 * Features:
 * - Async logging option to avoid blocking main flow
 * - Batch logging for high-frequency operations
 * - Automatic context enrichment
 */
export class AuditService implements IAuditService {
  private pendingLogs: Omit<IAuditLog, 'id' | 'timestamp'>[] = [];
  private flushTimer?: NodeJS.Timeout;
  private readonly batchSize = 50;
  private readonly flushIntervalMs = 1000;

  constructor(
    private repository: IAuditLogRepository,
    private options: {
      asyncMode?: boolean;      // If true, batch logs and flush periodically
      defaultActorType?: ActorType;
    } = {}
  ) {
    if (this.options.asyncMode) {
      this.startFlushTimer();
    }
  }

  /**
   * Stop the flush timer and flush any pending logs
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush();
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  private flush(): void {
    if (this.pendingLogs.length === 0) return;

    const logsToFlush = [...this.pendingLogs];
    this.pendingLogs = [];

    try {
      this.repository.logBatch(logsToFlush);
    } catch (error) {
      // On error, add logs back to pending (up to a limit to prevent memory issues)
      const maxPending = this.batchSize * 10;
      this.pendingLogs = [...logsToFlush, ...this.pendingLogs].slice(0, maxPending);
      console.error('[AuditService] Failed to flush logs:', error);
    }
  }

  private log(entry: Omit<IAuditLog, 'id' | 'timestamp'>): void {
    if (this.options.asyncMode) {
      this.pendingLogs.push(entry);
      if (this.pendingLogs.length >= this.batchSize) {
        this.flush();
      }
    } else {
      this.repository.log(entry);
    }
  }

  // ============================================================================
  // Goal Operations
  // ============================================================================

  logGoalCreated(
    goalId: string,
    actor: string,
    actorType: ActorType,
    data: Record<string, unknown>
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'goal.created',
      entity_type: 'goal',
      entity_id: goalId,
      goal_id: goalId,
      new_value: data,
    });
  }

  logGoalStatusChanged(
    goalId: string,
    actor: string,
    actorType: ActorType,
    oldStatus: string,
    newStatus: string
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'goal.status_changed',
      entity_type: 'goal',
      entity_id: goalId,
      goal_id: goalId,
      old_value: { status: oldStatus },
      new_value: { status: newStatus },
    });
  }

  logGoalCancelled(
    goalId: string,
    actor: string,
    actorType: ActorType,
    reason?: string
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'goal.cancelled',
      entity_type: 'goal',
      entity_id: goalId,
      goal_id: goalId,
      metadata: reason ? { reason } : undefined,
    });
  }

  logGoalBudgetUpdated(
    goalId: string,
    actor: string,
    actorType: ActorType,
    oldBudget: Record<string, unknown>,
    newBudget: Record<string, unknown>
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'goal.budget_updated',
      entity_type: 'goal',
      entity_id: goalId,
      goal_id: goalId,
      old_value: oldBudget,
      new_value: newBudget,
    });
  }

  // ============================================================================
  // Work Item Operations
  // ============================================================================

  logWorkItemCreated(
    workItemId: string,
    goalId: string,
    actor: string,
    actorType: ActorType,
    data: Record<string, unknown>
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'work_item.created',
      entity_type: 'work_item',
      entity_id: workItemId,
      goal_id: goalId,
      work_item_id: workItemId,
      new_value: data,
    });
  }

  logWorkItemStatusChanged(
    workItemId: string,
    goalId: string,
    actor: string,
    actorType: ActorType,
    oldStatus: string,
    newStatus: string
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'work_item.status_changed',
      entity_type: 'work_item',
      entity_id: workItemId,
      goal_id: goalId,
      work_item_id: workItemId,
      old_value: { status: oldStatus },
      new_value: { status: newStatus },
    });
  }

  logWorkItemRetry(
    workItemId: string,
    goalId: string,
    actor: string,
    actorType: ActorType,
    retryCount: number,
    reason?: string
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'work_item.retry',
      entity_type: 'work_item',
      entity_id: workItemId,
      goal_id: goalId,
      work_item_id: workItemId,
      new_value: { retry_count: retryCount },
      metadata: reason ? { reason } : undefined,
    });
  }

  // ============================================================================
  // Run Operations
  // ============================================================================

  logRunStarted(
    runId: string,
    workItemId: string,
    goalId: string,
    agentType: string
  ): void {
    this.log({
      actor: agentType,
      actor_type: 'agent',
      action: 'run.started',
      entity_type: 'run',
      entity_id: runId,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      new_value: { agent_type: agentType },
    });
  }

  logRunCompleted(
    runId: string,
    workItemId: string,
    goalId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      actor: 'system',
      actor_type: 'system',
      action: 'run.completed',
      entity_type: 'run',
      entity_id: runId,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      new_value: { status },
      metadata,
    });
  }

  logRunAborted(
    runId: string,
    workItemId: string,
    goalId: string,
    actor: string,
    actorType: ActorType,
    reason?: string
  ): void {
    this.log({
      actor,
      actor_type: actorType,
      action: 'run.aborted',
      entity_type: 'run',
      entity_id: runId,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      new_value: { status: 'aborted' },
      metadata: reason ? { reason } : undefined,
    });
  }

  // ============================================================================
  // Tool Operations
  // ============================================================================

  logToolInvoked(
    toolName: string,
    runId: string,
    workItemId: string,
    goalId: string,
    args?: Record<string, unknown>
  ): void {
    // Sanitize args to avoid logging sensitive data
    const sanitizedArgs = args ? this.sanitizeToolArgs(toolName, args) : undefined;

    this.log({
      actor: toolName,
      actor_type: 'agent',
      action: 'tool.invoked',
      entity_type: 'tool',
      entity_id: toolName,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      new_value: sanitizedArgs,
    });
  }

  logToolCompleted(
    toolName: string,
    runId: string,
    workItemId: string,
    goalId: string,
    result?: unknown
  ): void {
    this.log({
      actor: toolName,
      actor_type: 'agent',
      action: 'tool.completed',
      entity_type: 'tool',
      entity_id: toolName,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      metadata: result !== undefined ? { result_type: typeof result } : undefined,
    });
  }

  logToolBlocked(
    toolName: string,
    runId: string,
    workItemId: string,
    goalId: string,
    reason: string
  ): void {
    this.log({
      actor: 'system',
      actor_type: 'system',
      action: 'tool.blocked',
      entity_type: 'tool',
      entity_id: toolName,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      metadata: { reason },
    });
  }

  logToolFailed(
    toolName: string,
    runId: string,
    workItemId: string,
    goalId: string,
    error: string
  ): void {
    this.log({
      actor: toolName,
      actor_type: 'agent',
      action: 'tool.failed',
      entity_type: 'tool',
      entity_id: toolName,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      metadata: { error },
    });
  }

  // ============================================================================
  // Auth Operations
  // ============================================================================

  logAuthEvent(
    action: 'auth.challenge_issued' | 'auth.authenticated' | 'auth.failed' | 'auth.token_created' | 'auth.token_revoked',
    actor: string,
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      actor,
      actor_type: 'user',
      action,
      entity_type: 'auth',
      entity_id: actor,
      metadata,
    });
  }

  // ============================================================================
  // Escalation Operations
  // ============================================================================

  logEscalationCreated(
    escalationId: string,
    workItemId: string,
    goalId: string,
    type: string,
    severity: string
  ): void {
    this.log({
      actor: 'system',
      actor_type: 'system',
      action: 'escalation.created',
      entity_type: 'escalation',
      entity_id: escalationId,
      goal_id: goalId,
      work_item_id: workItemId,
      new_value: { type, severity },
    });
  }

  logEscalationAcknowledged(
    escalationId: string,
    workItemId: string,
    goalId: string,
    acknowledger: string
  ): void {
    this.log({
      actor: acknowledger,
      actor_type: 'user',
      action: 'escalation.acknowledged',
      entity_type: 'escalation',
      entity_id: escalationId,
      goal_id: goalId,
      work_item_id: workItemId,
    });
  }

  logEscalationResolved(
    escalationId: string,
    workItemId: string,
    goalId: string,
    resolver: string,
    action: string
  ): void {
    this.log({
      actor: resolver,
      actor_type: 'user',
      action: 'escalation.resolved',
      entity_type: 'escalation',
      entity_id: escalationId,
      goal_id: goalId,
      work_item_id: workItemId,
      new_value: { resolution_action: action },
    });
  }

  logEscalationDismissed(
    escalationId: string,
    workItemId: string,
    goalId: string,
    dismisser: string,
    reason?: string
  ): void {
    this.log({
      actor: dismisser,
      actor_type: 'user',
      action: 'escalation.dismissed',
      entity_type: 'escalation',
      entity_id: escalationId,
      goal_id: goalId,
      work_item_id: workItemId,
      metadata: reason ? { reason } : undefined,
    });
  }

  // ============================================================================
  // Session Operations
  // ============================================================================

  logSessionCreated(
    sessionId: string,
    actor: string,
    personaId: string
  ): void {
    this.log({
      actor,
      actor_type: 'user',
      action: 'session.created',
      entity_type: 'session',
      entity_id: sessionId,
      session_id: sessionId,
      new_value: { persona_id: personaId },
    });
  }

  logSessionEnded(
    sessionId: string,
    actor: string,
    reason?: string
  ): void {
    this.log({
      actor,
      actor_type: 'user',
      action: 'session.ended',
      entity_type: 'session',
      entity_id: sessionId,
      session_id: sessionId,
      metadata: reason ? { reason } : undefined,
    });
  }

  // ============================================================================
  // Permission Operations
  // ============================================================================

  logPermissionRequested(
    permissionId: string,
    toolName: string,
    goalId: string,
    reason: string
  ): void {
    this.log({
      actor: 'system',
      actor_type: 'system',
      action: 'permission.requested',
      entity_type: 'permission',
      entity_id: permissionId,
      goal_id: goalId,
      new_value: { tool_name: toolName, reason },
    });
  }

  logPermissionGranted(
    permissionId: string,
    toolName: string,
    goalId: string,
    grantedBy: string
  ): void {
    this.log({
      actor: grantedBy,
      actor_type: 'user',
      action: 'permission.granted',
      entity_type: 'permission',
      entity_id: permissionId,
      goal_id: goalId,
      new_value: { tool_name: toolName },
    });
  }

  logPermissionDenied(
    permissionId: string,
    toolName: string,
    goalId: string,
    deniedBy: string,
    reason?: string
  ): void {
    this.log({
      actor: deniedBy,
      actor_type: 'user',
      action: 'permission.denied',
      entity_type: 'permission',
      entity_id: permissionId,
      goal_id: goalId,
      new_value: { tool_name: toolName },
      metadata: reason ? { reason } : undefined,
    });
  }

  // ============================================================================
  // Artifact Operations
  // ============================================================================

  logArtifactCreated(
    artifactId: string,
    runId: string,
    workItemId: string,
    goalId: string,
    artifactType: string
  ): void {
    this.log({
      actor: 'system',
      actor_type: 'system',
      action: 'artifact.created',
      entity_type: 'artifact',
      entity_id: artifactId,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      new_value: { artifact_type: artifactType },
    });
  }

  // ============================================================================
  // Decision Operations
  // ============================================================================

  logDecisionRecorded(
    decisionId: string,
    runId: string,
    workItemId: string,
    goalId: string,
    decisionType: string,
    selectedOption: string
  ): void {
    this.log({
      actor: 'agent',
      actor_type: 'agent',
      action: 'decision.recorded',
      entity_type: 'decision',
      entity_id: decisionId,
      goal_id: goalId,
      work_item_id: workItemId,
      run_id: runId,
      new_value: { decision_type: decisionType, selected_option: selectedOption },
    });
  }

  // ============================================================================
  // Query Operations
  // ============================================================================

  getLogsForGoal(goalId: string, limit = 100): IAuditLog[] {
    return this.repository.getByGoalId(goalId, limit);
  }

  getLogsForEntity(entityType: AuditEntityType, entityId: string, limit = 100): IAuditLog[] {
    return this.repository.getByEntityId(entityType, entityId, limit);
  }

  getRecentLogs(limit = 100): IAuditLog[] {
    return this.repository.getRecent(limit);
  }

  getLogsByAction(action: AuditAction, limit = 100): IAuditLog[] {
    return this.repository.getByAction(action, limit);
  }

  getLogsByActionPrefix(prefix: string, limit = 100): IAuditLog[] {
    return this.repository.getByActionPrefix(prefix, limit);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Sanitize tool arguments to avoid logging sensitive data
   */
  private sanitizeToolArgs(
    toolName: string,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'credential', 'auth'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(k => lowerKey.includes(k))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = `[STRING:${value.length} chars]`;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
