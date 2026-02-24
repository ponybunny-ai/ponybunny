/**
 * Session Repository
 * Manages conversation session persistence
 */

import type {
  ConversationLifecycleState,
  IArchivedSessionSnapshot,
  IConversationSession,
  ISessionSummary,
  IConversationTurn,
} from '../../domain/conversation/session.js';
import type { ISessionRepository } from '../../app/conversation/session-manager.js';
import * as crypto from 'crypto';

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * In-memory session repository
 * For production, this should be replaced with SQLite persistence
 */
export class InMemorySessionRepository implements ISessionRepository {
  private sessions = new Map<string, IConversationSession>();

  createSession(personaId: string): IConversationSession {
    const session: IConversationSession = {
      id: generateId(),
      personaId,
      state: 'idle',
      lifecycleState: 'active',
      turns: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): IConversationSession | null {
    return this.sessions.get(id) || null;
  }

  updateSession(session: IConversationSession): void {
    session.updatedAt = Date.now();
    this.sessions.set(session.id, session);
  }

  addTurn(sessionId: string, turn: IConversationTurn): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.turns.push(turn);
      session.updatedAt = Date.now();
    }
  }

  deleteSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  listSessions(limit?: number): IConversationSession[] {
    const sessions = Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return limit ? sessions.slice(0, limit) : sessions;
  }

  listSessionsSummary(options?: {
    limit?: number;
    lifecycleState?: ConversationLifecycleState;
  }): ISessionSummary[] {
    const lifecycleState = options?.lifecycleState;
    const sessions = Array.from(this.sessions.values())
      .filter((session) => (lifecycleState ? (session.lifecycleState ?? 'active') === lifecycleState : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const selected = options?.limit ? sessions.slice(0, options.limit) : sessions;

    return selected.map((session) => ({
      id: session.id,
      personaId: session.personaId,
      state: session.state,
      lifecycleState: session.lifecycleState ?? 'active',
      archivedAt: session.archivedAt,
      archiveSummary: session.archiveSummary,
      turnCount: session.turns.length,
      lastMessage: session.turns[session.turns.length - 1]?.content,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  }

  archiveSession(sessionId: string, snapshot: IArchivedSessionSnapshot): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.lifecycleState = 'archived';
    session.archivedAt = snapshot.archivedAt;
    session.archiveSummary = snapshot.summary;
    session.archiveMetadata = snapshot.metadata;
    session.updatedAt = Date.now();
    this.sessions.set(sessionId, session);
    return true;
  }

  resumeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.lifecycleState = 'active';
    session.archivedAt = undefined;
    session.updatedAt = Date.now();
    this.sessions.set(sessionId, session);
    return true;
  }

  // Cleanup old sessions
  cleanupOldSessions(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;
    for (const [id, session] of this.sessions) {
      if (session.updatedAt < cutoff) {
        this.sessions.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}
