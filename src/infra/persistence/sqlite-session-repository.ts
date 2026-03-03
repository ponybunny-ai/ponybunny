/**
 * SQLite Session Repository
 * Persistent storage for conversation sessions
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type {
  ConversationLifecycleState,
  IArchivedSessionSnapshot,
  IConversationSession,
  IConversationTurn,
  ISessionSummary,
} from '../../domain/conversation/session.js';
import type { ISessionRepository } from '../../app/conversation/session-manager.js';
import type { ConversationState } from '../../domain/conversation/state-machine-rules.js';

// ============================================================================
// Database Row Types
// ============================================================================

interface SessionRow {
  id: string;
  persona_id: string;
  state: string;
  lifecycle_state: string;
  active_goal_id: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  archived_at: number | null;
  archive_summary: string | null;
  archive_metadata: string | null;
  metadata: string | null;
}

function deriveSessionTitleFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const normalized = text.trim();
  if (!normalized) return undefined;
  return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
}

interface SessionTurnRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  attachments: string | null;
  metadata: string | null;
}

// ============================================================================
// SQLite Session Repository
// ============================================================================

export class SqliteSessionRepository implements ISessionRepository {
  constructor(private db: Database.Database) {}

  /**
   * Initialize session tables
   */
  initialize(): void {
    this.db.exec(`
      -- Sessions Table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        state TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        active_goal_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        archived_at INTEGER,
        archive_summary TEXT,
        archive_metadata TEXT,
        metadata TEXT
      );

      -- Session Turns Table
      CREATE TABLE IF NOT EXISTS session_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        attachments TEXT,
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Indexes safe for all schema versions
      CREATE INDEX IF NOT EXISTS idx_session_turns_session ON session_turns(session_id, timestamp);
    `);

    this.ensureSessionLifecycleColumns();
  }

  private ensureSessionLifecycleColumns(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(sessions)')
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((item) => item.name));

    if (!names.has('lifecycle_state')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'");
    }
    if (!names.has('archived_at')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN archived_at INTEGER');
    }
    if (!names.has('archive_summary')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN archive_summary TEXT');
    }
    if (!names.has('archive_metadata')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN archive_metadata TEXT');
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_persona ON sessions(persona_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_goal ON sessions(active_goal_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_lifecycle ON sessions(lifecycle_state, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived_at DESC);
    `);
  }

  private parseSessionRow(row: SessionRow, turns: IConversationTurn[] = []): IConversationSession {
    return {
      id: row.id,
      personaId: row.persona_id,
      state: row.state as ConversationState,
      lifecycleState: (row.lifecycle_state as ConversationLifecycleState) || 'active',
      turns,
      activeGoalId: row.active_goal_id ?? undefined,
      archivedAt: row.archived_at ?? undefined,
      archiveSummary: row.archive_summary ?? undefined,
      archiveMetadata: row.archive_metadata ? JSON.parse(row.archive_metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private parseTurnRow(row: SessionTurnRow): IConversationTurn {
    return {
      id: row.id,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      timestamp: row.timestamp,
      attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private getTurnsForSession(sessionId: string): IConversationTurn[] {
    const stmt = this.db.prepare(`
      SELECT * FROM session_turns
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all(sessionId) as SessionTurnRow[];
    return rows.map(r => this.parseTurnRow(r));
  }

  createSession(personaId: string): IConversationSession {
    const now = Date.now();
    const session: IConversationSession = {
      id: randomUUID(),
      personaId,
      state: 'idle',
      lifecycleState: 'active',
      turns: [],
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id, persona_id, state, lifecycle_state, active_goal_id, created_at, updated_at, expires_at, archived_at, archive_summary, archive_metadata, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.personaId,
      session.state,
      session.lifecycleState ?? 'active',
      null,
      session.createdAt,
      session.updatedAt,
      null,
      null,
      null,
      null,
      null
    );

    return session;
  }

  getSession(id: string): IConversationSession | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;

    if (!row) return null;

    const turns = this.getTurnsForSession(id);
    return this.parseSessionRow(row, turns);
  }

  updateSession(session: IConversationSession): void {
    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE sessions SET
        state = ?,
        lifecycle_state = ?,
        active_goal_id = ?,
        updated_at = ?,
        archived_at = ?,
        archive_summary = ?,
        archive_metadata = ?,
        metadata = ?
      WHERE id = ?
    `);

    stmt.run(
      session.state,
      session.lifecycleState ?? 'active',
      session.activeGoalId ?? null,
      now,
      session.archivedAt ?? null,
      session.archiveSummary ?? null,
      session.archiveMetadata ? JSON.stringify(session.archiveMetadata) : null,
      session.metadata ? JSON.stringify(session.metadata) : null,
      session.id
    );
  }

  addTurn(sessionId: string, turn: IConversationTurn): void {
    const stmt = this.db.prepare(`
      INSERT INTO session_turns (
        id, session_id, role, content, timestamp, attachments, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      turn.id,
      sessionId,
      turn.role,
      turn.content,
      turn.timestamp,
      turn.attachments ? JSON.stringify(turn.attachments) : null,
      turn.metadata ? JSON.stringify(turn.metadata) : null
    );

    // Update session's updated_at
    const updateStmt = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
    updateStmt.run(Date.now(), sessionId);
  }

  deleteSession(id: string): boolean {
    // Turns will be deleted via CASCADE
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  listSessions(limit?: number): IConversationSession[] {
    const query = limit
      ? 'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT * FROM sessions ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const rows = (limit ? stmt.all(limit) : stmt.all()) as SessionRow[];

    return rows.map(row => {
      const turns = this.getTurnsForSession(row.id);
      return this.parseSessionRow(row, turns);
    });
  }

  /**
   * List sessions without loading all turns (for performance)
   */
  listSessionsSummary(options?: {
    limit?: number;
    lifecycleState?: ConversationLifecycleState;
  }): ISessionSummary[] {
    const lifecycleState = options?.lifecycleState;
    const limit = options?.limit;
    const query = `
      SELECT
        s.id,
        s.persona_id,
        s.metadata,
        s.state,
        s.lifecycle_state,
        s.archived_at,
        s.archive_summary,
        s.created_at,
        s.updated_at,
        COUNT(t.id) as turn_count,
        (
          SELECT st.content
          FROM session_turns st
          WHERE st.session_id = s.id
          ORDER BY st.timestamp DESC
          LIMIT 1
        ) as last_message,
        (
          SELECT st2.content
          FROM session_turns st2
          WHERE st2.session_id = s.id AND st2.role = 'user'
          ORDER BY st2.timestamp ASC
          LIMIT 1
        ) as first_user_message
      FROM sessions s
      LEFT JOIN session_turns t ON s.id = t.session_id
      ${lifecycleState ? 'WHERE s.lifecycle_state = ?' : ''}
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      ${limit ? 'LIMIT ?' : ''}
    `;

    const stmt = this.db.prepare(query);
    const rows = (
      lifecycleState && limit
        ? stmt.all(lifecycleState, limit)
        : lifecycleState
          ? stmt.all(lifecycleState)
          : limit
            ? stmt.all(limit)
            : stmt.all()
    ) as Array<{
      id: string;
      persona_id: string;
      metadata: string | null;
      state: string;
      lifecycle_state: string;
      archived_at: number | null;
      archive_summary: string | null;
      created_at: number;
      updated_at: number;
      turn_count: number;
      last_message: string | null;
      first_user_message: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      personaId: row.persona_id,
      title: (() => {
        if (row.metadata) {
          try {
            const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
            if (typeof metadata.title === 'string' && metadata.title.trim().length > 0) {
              return metadata.title;
            }
          } catch (error) {
            void error;
          }
        }
        return deriveSessionTitleFromText(row.first_user_message ?? undefined);
      })(),
      state: row.state as ConversationState,
      lifecycleState: (row.lifecycle_state as ConversationLifecycleState) || 'active',
      archivedAt: row.archived_at ?? undefined,
      archiveSummary: row.archive_summary ?? undefined,
      turnCount: row.turn_count,
      lastMessage: row.last_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  archiveSession(sessionId: string, snapshot: IArchivedSessionSnapshot): boolean {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET lifecycle_state = 'archived',
          archived_at = ?,
          archive_summary = ?,
          archive_metadata = ?,
          updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(
      snapshot.archivedAt,
      snapshot.summary,
      JSON.stringify(snapshot.metadata),
      Date.now(),
      sessionId
    );
    return result.changes > 0;
  }

  resumeSession(sessionId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET lifecycle_state = 'active',
          archived_at = NULL,
          updated_at = ?
      WHERE id = ?
    `);
    const result = stmt.run(Date.now(), sessionId);
    return result.changes > 0;
  }

  /**
   * Get sessions by goal ID
   */
  getSessionsByGoal(goalId: string): IConversationSession[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE active_goal_id = ?
      ORDER BY updated_at DESC
    `);
    const rows = stmt.all(goalId) as SessionRow[];

    return rows.map(row => {
      const turns = this.getTurnsForSession(row.id);
      return this.parseSessionRow(row, turns);
    });
  }

  /**
   * Get sessions by persona ID
   */
  getSessionsByPersona(personaId: string, limit?: number): IConversationSession[] {
    const query = limit
      ? 'SELECT * FROM sessions WHERE persona_id = ? ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT * FROM sessions WHERE persona_id = ? ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const rows = (limit ? stmt.all(personaId, limit) : stmt.all(personaId)) as SessionRow[];

    return rows.map(row => {
      const turns = this.getTurnsForSession(row.id);
      return this.parseSessionRow(row, turns);
    });
  }

  /**
   * Set session expiration
   */
  setExpiration(sessionId: string, expiresAt: number): void {
    const stmt = this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?');
    stmt.run(expiresAt, sessionId);
  }

  /**
   * Get expired sessions
   */
  getExpiredSessions(): IConversationSession[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `);
    const rows = stmt.all(now) as SessionRow[];

    return rows.map(row => {
      const turns = this.getTurnsForSession(row.id);
      return this.parseSessionRow(row, turns);
    });
  }

  /**
   * Cleanup old sessions (by age)
   */
  cleanupOldSessions(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const stmt = this.db.prepare('DELETE FROM sessions WHERE updated_at < ?');
    const result = stmt.run(cutoff);
    return result.changes;
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    const stmt = this.db.prepare(`
      DELETE FROM sessions
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `);
    const result = stmt.run(now);
    return result.changes;
  }

  /**
   * Get session count
   */
  count(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM sessions');
    const row = stmt.get() as { count: number };
    return row.count;
  }

  /**
   * Get turn count for a session
   */
  getTurnCount(sessionId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM session_turns WHERE session_id = ?');
    const row = stmt.get(sessionId) as { count: number };
    return row.count;
  }

  /**
   * Get recent turns for a session (for context window)
   */
  getRecentTurns(sessionId: string, limit: number): IConversationTurn[] {
    const stmt = this.db.prepare(`
      SELECT * FROM session_turns
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(sessionId, limit) as SessionTurnRow[];
    // Reverse to get chronological order
    return rows.map(r => this.parseTurnRow(r)).reverse();
  }

  /**
   * Delete old turns for a session (keep only recent N)
   */
  pruneOldTurns(sessionId: string, keepCount: number): number {
    // Get IDs of turns to keep
    const keepStmt = this.db.prepare(`
      SELECT id FROM session_turns
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const keepRows = keepStmt.all(sessionId, keepCount) as { id: string }[];
    const keepIds = keepRows.map(r => r.id);

    if (keepIds.length === 0) return 0;

    // Delete all other turns
    const placeholders = keepIds.map(() => '?').join(',');
    const deleteStmt = this.db.prepare(`
      DELETE FROM session_turns
      WHERE session_id = ? AND id NOT IN (${placeholders})
    `);
    const result = deleteStmt.run(sessionId, ...keepIds);
    return result.changes;
  }
}
