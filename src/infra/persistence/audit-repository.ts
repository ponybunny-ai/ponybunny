import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type {
  IAuditLog,
  IAuditLogRepository,
  AuditLogRow,
  AuditAction,
  AuditEntityType,
  ActorType,
} from '../../domain/audit/types.js';

/**
 * SQLite implementation of the Audit Log Repository
 *
 * Provides persistent storage for all audit logs with efficient indexing
 * for common query patterns.
 */
export class AuditLogRepository implements IAuditLogRepository {
  constructor(private db: Database.Database) {}

  /**
   * Initialize the audit log table and indexes
   */
  initialize(): void {
    this.db.exec(`
      -- Audit Logs Table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        actor TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        goal_id TEXT,
        work_item_id TEXT,
        run_id TEXT,
        session_id TEXT,
        old_value TEXT,
        new_value TEXT,
        metadata TEXT,
        ip_address TEXT,
        user_agent TEXT
      );

      -- Indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_goal ON audit_logs(goal_id);
      CREATE INDEX IF NOT EXISTS idx_audit_work_item ON audit_logs(work_item_id);
      CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_logs(run_id);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);
    `);
  }

  private parseRow(row: AuditLogRow): IAuditLog {
    return {
      id: row.id,
      timestamp: row.timestamp,
      actor: row.actor,
      actor_type: row.actor_type,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      goal_id: row.goal_id ?? undefined,
      work_item_id: row.work_item_id ?? undefined,
      run_id: row.run_id ?? undefined,
      session_id: row.session_id ?? undefined,
      old_value: row.old_value ? JSON.parse(row.old_value) : undefined,
      new_value: row.new_value ? JSON.parse(row.new_value) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      ip_address: row.ip_address ?? undefined,
      user_agent: row.user_agent ?? undefined,
    };
  }

  log(entry: Omit<IAuditLog, 'id' | 'timestamp'>): IAuditLog {
    const auditLog: IAuditLog = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...entry,
    };

    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (
        id, timestamp, actor, actor_type, action, entity_type, entity_id,
        goal_id, work_item_id, run_id, session_id,
        old_value, new_value, metadata, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      auditLog.id,
      auditLog.timestamp,
      auditLog.actor,
      auditLog.actor_type,
      auditLog.action,
      auditLog.entity_type,
      auditLog.entity_id,
      auditLog.goal_id ?? null,
      auditLog.work_item_id ?? null,
      auditLog.run_id ?? null,
      auditLog.session_id ?? null,
      auditLog.old_value !== undefined ? JSON.stringify(auditLog.old_value) : null,
      auditLog.new_value !== undefined ? JSON.stringify(auditLog.new_value) : null,
      auditLog.metadata ? JSON.stringify(auditLog.metadata) : null,
      auditLog.ip_address ?? null,
      auditLog.user_agent ?? null
    );

    return auditLog;
  }

  logBatch(entries: Omit<IAuditLog, 'id' | 'timestamp'>[]): IAuditLog[] {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (
        id, timestamp, actor, actor_type, action, entity_type, entity_id,
        goal_id, work_item_id, run_id, session_id,
        old_value, new_value, metadata, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const results: IAuditLog[] = [];
    const now = Date.now();

    const insertMany = this.db.transaction((items: Omit<IAuditLog, 'id' | 'timestamp'>[]) => {
      for (const entry of items) {
        const auditLog: IAuditLog = {
          id: randomUUID(),
          timestamp: now,
          ...entry,
        };

        stmt.run(
          auditLog.id,
          auditLog.timestamp,
          auditLog.actor,
          auditLog.actor_type,
          auditLog.action,
          auditLog.entity_type,
          auditLog.entity_id,
          auditLog.goal_id ?? null,
          auditLog.work_item_id ?? null,
          auditLog.run_id ?? null,
          auditLog.session_id ?? null,
          auditLog.old_value !== undefined ? JSON.stringify(auditLog.old_value) : null,
          auditLog.new_value !== undefined ? JSON.stringify(auditLog.new_value) : null,
          auditLog.metadata ? JSON.stringify(auditLog.metadata) : null,
          auditLog.ip_address ?? null,
          auditLog.user_agent ?? null
        );

        results.push(auditLog);
      }
    });

    insertMany(entries);
    return results;
  }

  getById(id: string): IAuditLog | undefined {
    const stmt = this.db.prepare('SELECT * FROM audit_logs WHERE id = ?');
    const row = stmt.get(id) as AuditLogRow | undefined;
    return row ? this.parseRow(row) : undefined;
  }

  getByEntityId(entityType: AuditEntityType, entityId: string, limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(entityType, entityId, limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  getByGoalId(goalId: string, limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE goal_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(goalId, limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  getByActor(actor: string, limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE actor = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(actor, limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  getByAction(action: AuditAction, limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE action = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(action, limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  getByActionPrefix(prefix: string, limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE action LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(`${prefix}%`, limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  getByTimeRange(from: number, to: number, limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(from, to, limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  getRecent(limit = 100): IAuditLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_logs
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as AuditLogRow[];
    return rows.map(r => this.parseRow(r));
  }

  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const stmt = this.db.prepare('DELETE FROM audit_logs WHERE timestamp < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  count(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM audit_logs');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Get statistics about audit logs
   */
  getStatistics(): {
    total: number;
    by_action: Record<string, number>;
    by_entity_type: Record<string, number>;
    by_actor_type: Record<string, number>;
    oldest_timestamp?: number;
    newest_timestamp?: number;
  } {
    const total = this.count();

    const actionStmt = this.db.prepare(`
      SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action
    `);
    const actionRows = actionStmt.all() as { action: string; count: number }[];
    const by_action: Record<string, number> = {};
    for (const row of actionRows) {
      by_action[row.action] = row.count;
    }

    const entityStmt = this.db.prepare(`
      SELECT entity_type, COUNT(*) as count FROM audit_logs GROUP BY entity_type
    `);
    const entityRows = entityStmt.all() as { entity_type: string; count: number }[];
    const by_entity_type: Record<string, number> = {};
    for (const row of entityRows) {
      by_entity_type[row.entity_type] = row.count;
    }

    const actorTypeStmt = this.db.prepare(`
      SELECT actor_type, COUNT(*) as count FROM audit_logs GROUP BY actor_type
    `);
    const actorTypeRows = actorTypeStmt.all() as { actor_type: string; count: number }[];
    const by_actor_type: Record<string, number> = {};
    for (const row of actorTypeRows) {
      by_actor_type[row.actor_type] = row.count;
    }

    const timeStmt = this.db.prepare(`
      SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM audit_logs
    `);
    const timeRow = timeStmt.get() as { oldest: number | null; newest: number | null };

    return {
      total,
      by_action,
      by_entity_type,
      by_actor_type,
      oldest_timestamp: timeRow.oldest ?? undefined,
      newest_timestamp: timeRow.newest ?? undefined,
    };
  }
}
