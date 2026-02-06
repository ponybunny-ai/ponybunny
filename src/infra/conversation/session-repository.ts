/**
 * Session Repository
 * Manages conversation session persistence
 */

import type {
  IConversationSession,
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
