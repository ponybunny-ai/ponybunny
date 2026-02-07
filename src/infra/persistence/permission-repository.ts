import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type {
  IPermissionRequest,
  IPermissionGrant,
  IPermissionRepository,
  PermissionRequestRow,
  PermissionGrantRow,
  PermissionRequestStatus,
} from '../../domain/permission/types.js';

/**
 * SQLite implementation of Permission Repository
 */
export class PermissionRepository implements IPermissionRepository {
  constructor(private db: Database.Database) {}

  /**
   * Initialize permission tables
   */
  initialize(): void {
    this.db.exec(`
      -- Permission Requests Table
      CREATE TABLE IF NOT EXISTS permission_requests (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        layer TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        work_item_id TEXT,
        run_id TEXT,
        reason TEXT NOT NULL,
        args_summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_at INTEGER,
        resolved_by TEXT,
        resolution_note TEXT
      );

      -- Permission Grants Table (cache)
      CREATE TABLE IF NOT EXISTS permission_grants (
        tool_name TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        granted_by TEXT NOT NULL,
        scope TEXT,
        PRIMARY KEY (tool_name, goal_id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_perm_req_goal ON permission_requests(goal_id);
      CREATE INDEX IF NOT EXISTS idx_perm_req_status ON permission_requests(status);
      CREATE INDEX IF NOT EXISTS idx_perm_req_expires ON permission_requests(expires_at);
      CREATE INDEX IF NOT EXISTS idx_perm_grant_expires ON permission_grants(expires_at);
    `);
  }

  private parseRequestRow(row: PermissionRequestRow): IPermissionRequest {
    return {
      id: row.id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      tool_name: row.tool_name,
      layer: 'approval_required',
      goal_id: row.goal_id,
      work_item_id: row.work_item_id ?? undefined,
      run_id: row.run_id ?? undefined,
      reason: row.reason,
      args_summary: row.args_summary,
      status: row.status as PermissionRequestStatus,
      resolved_at: row.resolved_at ?? undefined,
      resolved_by: row.resolved_by ?? undefined,
      resolution_note: row.resolution_note ?? undefined,
    };
  }

  private parseGrantRow(row: PermissionGrantRow): IPermissionGrant {
    return {
      tool_name: row.tool_name,
      goal_id: row.goal_id,
      granted_at: row.granted_at,
      expires_at: row.expires_at,
      granted_by: row.granted_by,
      scope: row.scope ?? undefined,
    };
  }

  // ============================================================================
  // Permission Requests
  // ============================================================================

  createRequest(
    params: Omit<IPermissionRequest, 'id' | 'created_at' | 'status'>
  ): IPermissionRequest {
    const request: IPermissionRequest = {
      id: randomUUID(),
      created_at: Date.now(),
      status: 'pending',
      ...params,
    };

    const stmt = this.db.prepare(`
      INSERT INTO permission_requests (
        id, created_at, expires_at, tool_name, layer, goal_id,
        work_item_id, run_id, reason, args_summary, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      request.id,
      request.created_at,
      request.expires_at,
      request.tool_name,
      request.layer,
      request.goal_id,
      request.work_item_id ?? null,
      request.run_id ?? null,
      request.reason,
      request.args_summary,
      request.status
    );

    return request;
  }

  getRequest(id: string): IPermissionRequest | undefined {
    const stmt = this.db.prepare('SELECT * FROM permission_requests WHERE id = ?');
    const row = stmt.get(id) as PermissionRequestRow | undefined;
    return row ? this.parseRequestRow(row) : undefined;
  }

  getPendingRequests(goalId?: string): IPermissionRequest[] {
    let query = 'SELECT * FROM permission_requests WHERE status = ?';
    const params: unknown[] = ['pending'];

    if (goalId) {
      query += ' AND goal_id = ?';
      params.push(goalId);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as PermissionRequestRow[];
    return rows.map(r => this.parseRequestRow(r));
  }

  resolveRequest(
    id: string,
    status: 'approved' | 'denied',
    resolvedBy: string,
    note?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE permission_requests
      SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE id = ?
    `);

    stmt.run(status, Date.now(), resolvedBy, note ?? null, id);
  }

  expireOldRequests(): number {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE permission_requests
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
    `);

    const result = stmt.run(now);
    return result.changes;
  }

  // ============================================================================
  // Permission Grants
  // ============================================================================

  grantPermission(grant: Omit<IPermissionGrant, 'granted_at'>): IPermissionGrant {
    const fullGrant: IPermissionGrant = {
      ...grant,
      granted_at: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO permission_grants (
        tool_name, goal_id, granted_at, expires_at, granted_by, scope
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fullGrant.tool_name,
      fullGrant.goal_id,
      fullGrant.granted_at,
      fullGrant.expires_at,
      fullGrant.granted_by,
      fullGrant.scope ?? null
    );

    return fullGrant;
  }

  getGrant(toolName: string, goalId: string): IPermissionGrant | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM permission_grants
      WHERE tool_name = ? AND goal_id = ? AND expires_at > ?
    `);

    const row = stmt.get(toolName, goalId, Date.now()) as PermissionGrantRow | undefined;
    return row ? this.parseGrantRow(row) : undefined;
  }

  revokeGrant(toolName: string, goalId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM permission_grants WHERE tool_name = ? AND goal_id = ?
    `);

    const result = stmt.run(toolName, goalId);
    return result.changes > 0;
  }

  revokeAllForGoal(goalId: string): number {
    const stmt = this.db.prepare('DELETE FROM permission_grants WHERE goal_id = ?');
    const result = stmt.run(goalId);
    return result.changes;
  }

  cleanupExpiredGrants(): number {
    const stmt = this.db.prepare('DELETE FROM permission_grants WHERE expires_at < ?');
    const result = stmt.run(Date.now());
    return result.changes;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getStatistics(): {
    pending_requests: number;
    approved_requests: number;
    denied_requests: number;
    active_grants: number;
  } {
    const reqStats = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM permission_requests GROUP BY status
    `).all() as { status: string; count: number }[];

    const grantCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM permission_grants WHERE expires_at > ?
    `).get(Date.now()) as { count: number };

    const stats = {
      pending_requests: 0,
      approved_requests: 0,
      denied_requests: 0,
      active_grants: grantCount.count,
    };

    for (const row of reqStats) {
      if (row.status === 'pending') stats.pending_requests = row.count;
      if (row.status === 'approved') stats.approved_requests = row.count;
      if (row.status === 'denied') stats.denied_requests = row.count;
    }

    return stats;
  }
}
