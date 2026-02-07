/**
 * OS Service Checker
 *
 * Manages permissions for operating system services.
 * Implements caching, request/grant workflow, and service availability checks.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  OSService,
  IOSServiceChecker,
  IOSServicePermission,
  IOSPermissionRequest,
  OSPermissionRequestRow,
  OSPermissionGrantRow,
  OSPermissionStatus,
} from '../../domain/permission/os-service.js';

const execAsync = promisify(exec);

// ============================================================================
// OS Permission Repository
// ============================================================================

export class OSPermissionRepository {
  constructor(private db: Database.Database) {}

  initialize(): void {
    this.db.exec(`
      -- OS Permission Requests Table
      CREATE TABLE IF NOT EXISTS os_permission_requests (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        scope TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        work_item_id TEXT,
        run_id TEXT,
        reason TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolved_at INTEGER,
        resolved_by TEXT,
        resolution_note TEXT
      );

      -- OS Permission Grants Table
      CREATE TABLE IF NOT EXISTS os_permission_grants (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        scope TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        granted_by TEXT NOT NULL,
        metadata TEXT,
        UNIQUE(service, scope, goal_id)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_os_perm_req_goal ON os_permission_requests(goal_id);
      CREATE INDEX IF NOT EXISTS idx_os_perm_req_status ON os_permission_requests(status);
      CREATE INDEX IF NOT EXISTS idx_os_perm_grant_goal ON os_permission_grants(goal_id);
      CREATE INDEX IF NOT EXISTS idx_os_perm_grant_expires ON os_permission_grants(expires_at);
    `);
  }

  // Request methods
  createRequest(params: Omit<IOSPermissionRequest, 'id' | 'requested_at' | 'status'>): IOSPermissionRequest {
    const request: IOSPermissionRequest = {
      id: randomUUID(),
      requested_at: Date.now(),
      status: 'pending',
      ...params,
    };

    const stmt = this.db.prepare(`
      INSERT INTO os_permission_requests (
        id, service, scope, goal_id, work_item_id, run_id,
        reason, requested_at, expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      request.id,
      request.service,
      request.scope,
      request.goal_id,
      request.work_item_id ?? null,
      request.run_id ?? null,
      request.reason,
      request.requested_at,
      request.expires_at,
      request.status
    );

    return request;
  }

  getRequest(id: string): IOSPermissionRequest | undefined {
    const stmt = this.db.prepare('SELECT * FROM os_permission_requests WHERE id = ?');
    const row = stmt.get(id) as OSPermissionRequestRow | undefined;
    return row ? this.parseRequestRow(row) : undefined;
  }

  getPendingRequests(goalId?: string): IOSPermissionRequest[] {
    let query = 'SELECT * FROM os_permission_requests WHERE status = ?';
    const params: unknown[] = ['pending'];

    if (goalId) {
      query += ' AND goal_id = ?';
      params.push(goalId);
    }

    query += ' ORDER BY requested_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as OSPermissionRequestRow[];
    return rows.map(r => this.parseRequestRow(r));
  }

  resolveRequest(
    id: string,
    status: 'granted' | 'denied',
    resolvedBy: string,
    note?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE os_permission_requests
      SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE id = ?
    `);
    stmt.run(status, Date.now(), resolvedBy, note ?? null, id);
  }

  // Grant methods
  createGrant(params: {
    service: OSService;
    scope: string;
    goalId: string;
    grantedBy: string;
    expiresAt: number;
    metadata?: Record<string, unknown>;
  }): IOSServicePermission {
    const grant: IOSServicePermission = {
      id: randomUUID(),
      service: params.service,
      scope: params.scope,
      goal_id: params.goalId,
      status: 'granted',
      requested_at: Date.now(),
      resolved_at: Date.now(),
      resolved_by: params.grantedBy,
      expires_at: params.expiresAt,
      reason: '',
      metadata: params.metadata,
    };

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO os_permission_grants (
        id, service, scope, goal_id, granted_at, expires_at, granted_by, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      grant.id,
      grant.service,
      grant.scope,
      grant.goal_id,
      Date.now(),
      params.expiresAt,
      params.grantedBy,
      params.metadata ? JSON.stringify(params.metadata) : null
    );

    return grant;
  }

  getGrant(service: OSService, scope: string, goalId: string): IOSServicePermission | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM os_permission_grants
      WHERE service = ? AND scope = ? AND goal_id = ? AND expires_at > ?
    `);
    const row = stmt.get(service, scope, goalId, Date.now()) as OSPermissionGrantRow | undefined;
    return row ? this.parseGrantRow(row) : undefined;
  }

  getActiveGrants(goalId: string): IOSServicePermission[] {
    const stmt = this.db.prepare(`
      SELECT * FROM os_permission_grants
      WHERE goal_id = ? AND expires_at > ?
      ORDER BY granted_at DESC
    `);
    const rows = stmt.all(goalId, Date.now()) as OSPermissionGrantRow[];
    return rows.map(r => this.parseGrantRow(r));
  }

  revokeGrant(service: OSService, scope: string, goalId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM os_permission_grants
      WHERE service = ? AND scope = ? AND goal_id = ?
    `);
    const result = stmt.run(service, scope, goalId);
    return result.changes > 0;
  }

  revokeAllForGoal(goalId: string): number {
    const stmt = this.db.prepare('DELETE FROM os_permission_grants WHERE goal_id = ?');
    const result = stmt.run(goalId);
    return result.changes;
  }

  cleanupExpired(): number {
    const now = Date.now();
    const stmt = this.db.prepare('DELETE FROM os_permission_grants WHERE expires_at < ?');
    const result = stmt.run(now);
    return result.changes;
  }

  private parseRequestRow(row: OSPermissionRequestRow): IOSPermissionRequest {
    return {
      id: row.id,
      service: row.service as OSService,
      scope: row.scope,
      goal_id: row.goal_id,
      work_item_id: row.work_item_id ?? undefined,
      run_id: row.run_id ?? undefined,
      reason: row.reason,
      requested_at: row.requested_at,
      expires_at: row.expires_at,
      status: row.status as OSPermissionStatus,
      resolved_at: row.resolved_at ?? undefined,
      resolved_by: row.resolved_by ?? undefined,
      resolution_note: row.resolution_note ?? undefined,
    };
  }

  private parseGrantRow(row: OSPermissionGrantRow): IOSServicePermission {
    return {
      id: row.id,
      service: row.service as OSService,
      scope: row.scope,
      goal_id: row.goal_id,
      status: 'granted',
      requested_at: row.granted_at,
      resolved_at: row.granted_at,
      resolved_by: row.granted_by,
      expires_at: row.expires_at,
      reason: '',
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

// ============================================================================
// OS Service Checker Implementation
// ============================================================================

export class OSServiceChecker implements IOSServiceChecker {
  private memoryCache = new Map<string, { expiresAt: number }>();

  constructor(private repository: OSPermissionRepository) {}

  private getCacheKey(service: OSService, scope: string, goalId: string): string {
    return `${goalId}:${service}:${scope}`;
  }

  async checkPermission(
    service: OSService,
    scope: string,
    goalId: string
  ): Promise<{ granted: boolean; cached: boolean; expiresAt?: number }> {
    const cacheKey = this.getCacheKey(service, scope, goalId);

    // Check memory cache first
    const cached = this.memoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { granted: true, cached: true, expiresAt: cached.expiresAt };
    }

    // Check database
    const grant = this.repository.getGrant(service, scope, goalId);
    if (grant && grant.expires_at && grant.expires_at > Date.now()) {
      // Update memory cache
      this.memoryCache.set(cacheKey, { expiresAt: grant.expires_at });
      return { granted: true, cached: false, expiresAt: grant.expires_at };
    }

    return { granted: false, cached: false };
  }

  async requestPermission(params: {
    service: OSService;
    scope: string;
    goalId: string;
    workItemId?: string;
    runId?: string;
    reason: string;
  }): Promise<string> {
    const request = this.repository.createRequest({
      service: params.service,
      scope: params.scope,
      goal_id: params.goalId,
      work_item_id: params.workItemId,
      run_id: params.runId,
      reason: params.reason,
      expires_at: Date.now() + 30 * 60 * 1000, // 30 minutes to respond
    });

    return request.id;
  }

  async grantPermission(
    requestId: string,
    grantedBy: string,
    expiresInMs: number = 60 * 60 * 1000 // 1 hour default
  ): Promise<void> {
    const request = this.repository.getRequest(requestId);
    if (!request) {
      throw new Error(`Permission request not found: ${requestId}`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Permission request is already ${request.status}`);
    }

    // Resolve the request
    this.repository.resolveRequest(requestId, 'granted', grantedBy);

    // Create the grant
    const expiresAt = Date.now() + expiresInMs;
    this.repository.createGrant({
      service: request.service,
      scope: request.scope,
      goalId: request.goal_id,
      grantedBy,
      expiresAt,
    });

    // Update memory cache
    const cacheKey = this.getCacheKey(request.service, request.scope, request.goal_id);
    this.memoryCache.set(cacheKey, { expiresAt });
  }

  async denyPermission(
    requestId: string,
    deniedBy: string,
    reason?: string
  ): Promise<void> {
    const request = this.repository.getRequest(requestId);
    if (!request) {
      throw new Error(`Permission request not found: ${requestId}`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Permission request is already ${request.status}`);
    }

    this.repository.resolveRequest(requestId, 'denied', deniedBy, reason);
  }

  async revokePermission(
    service: OSService,
    scope: string,
    goalId: string
  ): Promise<boolean> {
    // Remove from memory cache
    const cacheKey = this.getCacheKey(service, scope, goalId);
    this.memoryCache.delete(cacheKey);

    // Remove from database
    return this.repository.revokeGrant(service, scope, goalId);
  }

  async revokeAllForGoal(goalId: string): Promise<number> {
    // Clear memory cache for this goal
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`${goalId}:`)) {
        this.memoryCache.delete(key);
      }
    }

    // Remove from database
    return this.repository.revokeAllForGoal(goalId);
  }

  async listActivePermissions(goalId: string): Promise<IOSServicePermission[]> {
    return this.repository.getActiveGrants(goalId);
  }

  async listPendingRequests(goalId?: string): Promise<IOSPermissionRequest[]> {
    return this.repository.getPendingRequests(goalId);
  }

  async isServiceAvailable(service: OSService): Promise<boolean> {
    try {
      switch (service) {
        case 'docker':
          await execAsync('docker --version');
          return true;

        case 'browser':
          // Check for common browser executables
          try {
            await execAsync('which chromium || which google-chrome || which firefox');
            return true;
          } catch {
            return false;
          }

        case 'keychain':
          // macOS Keychain
          if (process.platform === 'darwin') {
            await execAsync('security --version');
            return true;
          }
          return false;

        case 'clipboard':
          // Check for clipboard utilities
          if (process.platform === 'darwin') {
            return true; // pbcopy/pbpaste
          }
          try {
            await execAsync('which xclip || which xsel');
            return true;
          } catch {
            return false;
          }

        case 'network':
        case 'filesystem':
        case 'process':
        case 'environment':
          // These are always available
          return true;

        case 'notifications':
          if (process.platform === 'darwin') {
            return true; // osascript
          }
          try {
            await execAsync('which notify-send');
            return true;
          } catch {
            return false;
          }

        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Cleanup expired grants and cache
   */
  cleanup(): number {
    // Clean memory cache
    const now = Date.now();
    for (const [key, value] of this.memoryCache.entries()) {
      if (value.expiresAt < now) {
        this.memoryCache.delete(key);
      }
    }

    // Clean database
    return this.repository.cleanupExpired();
  }
}
