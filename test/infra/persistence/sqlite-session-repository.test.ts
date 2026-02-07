import Database from 'better-sqlite3';
import { SqliteSessionRepository } from '../../../src/infra/persistence/sqlite-session-repository.js';
import type { IConversationTurn } from '../../../src/domain/conversation/session.js';

describe('SqliteSessionRepository', () => {
  let db: Database.Database;
  let repository: SqliteSessionRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repository = new SqliteSessionRepository(db);
    repository.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe('createSession', () => {
    it('should create a new session', () => {
      const session = repository.createSession('persona-1');

      expect(session.id).toBeDefined();
      expect(session.personaId).toBe('persona-1');
      expect(session.state).toBe('idle');
      expect(session.turns).toHaveLength(0);
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it('should persist the session to database', () => {
      const session = repository.createSession('persona-1');
      const retrieved = repository.getSession(session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
      expect(retrieved!.personaId).toBe('persona-1');
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', () => {
      const session = repository.getSession('non-existent');
      expect(session).toBeNull();
    });

    it('should return session with all turns', () => {
      const session = repository.createSession('persona-1');

      // Add some turns
      const turn1: IConversationTurn = {
        id: 'turn-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      const turn2: IConversationTurn = {
        id: 'turn-2',
        role: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now() + 1,
      };

      repository.addTurn(session.id, turn1);
      repository.addTurn(session.id, turn2);

      const retrieved = repository.getSession(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.turns).toHaveLength(2);
      expect(retrieved!.turns[0].content).toBe('Hello');
      expect(retrieved!.turns[1].content).toBe('Hi there!');
    });
  });

  describe('updateSession', () => {
    it('should update session state', () => {
      const session = repository.createSession('persona-1');
      session.state = 'executing';
      session.activeGoalId = 'goal-123';

      repository.updateSession(session);

      const retrieved = repository.getSession(session.id);
      expect(retrieved!.state).toBe('executing');
      expect(retrieved!.activeGoalId).toBe('goal-123');
    });

    it('should update session metadata', () => {
      const session = repository.createSession('persona-1');
      session.metadata = { context: 'test', priority: 'high' };

      repository.updateSession(session);

      const retrieved = repository.getSession(session.id);
      expect(retrieved!.metadata).toEqual({ context: 'test', priority: 'high' });
    });
  });

  describe('addTurn', () => {
    it('should add a turn to a session', () => {
      const session = repository.createSession('persona-1');

      const turn: IConversationTurn = {
        id: 'turn-1',
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
        metadata: { intent: 'greeting' },
      };

      repository.addTurn(session.id, turn);

      const retrieved = repository.getSession(session.id);
      expect(retrieved!.turns).toHaveLength(1);
      expect(retrieved!.turns[0].content).toBe('Test message');
      expect(retrieved!.turns[0].metadata).toEqual({ intent: 'greeting' });
    });

    it('should handle attachments', () => {
      const session = repository.createSession('persona-1');

      const turn: IConversationTurn = {
        id: 'turn-1',
        role: 'user',
        content: 'Check this image',
        timestamp: Date.now(),
        attachments: [
          { type: 'image', url: 'https://example.com/image.png', mimeType: 'image/png' },
        ],
      };

      repository.addTurn(session.id, turn);

      const retrieved = repository.getSession(session.id);
      expect(retrieved!.turns[0].attachments).toHaveLength(1);
      expect(retrieved!.turns[0].attachments![0].type).toBe('image');
    });
  });

  describe('deleteSession', () => {
    it('should delete a session and its turns', () => {
      const session = repository.createSession('persona-1');
      repository.addTurn(session.id, {
        id: 'turn-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });

      const deleted = repository.deleteSession(session.id);
      expect(deleted).toBe(true);

      const retrieved = repository.getSession(session.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = repository.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should list sessions ordered by updated_at', () => {
      const session1 = repository.createSession('persona-1');
      const session2 = repository.createSession('persona-2');
      const session3 = repository.createSession('persona-3');

      // Update session1 to make it most recent
      session1.state = 'executing';
      repository.updateSession(session1);

      const sessions = repository.listSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions[0].id).toBe(session1.id); // Most recently updated
    });

    it('should respect limit parameter', () => {
      repository.createSession('persona-1');
      repository.createSession('persona-2');
      repository.createSession('persona-3');

      const sessions = repository.listSessions(2);
      expect(sessions).toHaveLength(2);
    });
  });

  describe('listSessionsSummary', () => {
    it('should return session summaries with turn counts', () => {
      const session = repository.createSession('persona-1');
      repository.addTurn(session.id, { id: 't1', role: 'user', content: 'Hi', timestamp: Date.now() });
      repository.addTurn(session.id, { id: 't2', role: 'assistant', content: 'Hello', timestamp: Date.now() });

      const summaries = repository.listSessionsSummary();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].turnCount).toBe(2);
    });
  });

  describe('getSessionsByGoal', () => {
    it('should return sessions associated with a goal', () => {
      const session1 = repository.createSession('persona-1');
      session1.activeGoalId = 'goal-1';
      repository.updateSession(session1);

      const session2 = repository.createSession('persona-2');
      session2.activeGoalId = 'goal-2';
      repository.updateSession(session2);

      const sessions = repository.getSessionsByGoal('goal-1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session1.id);
    });
  });

  describe('cleanup', () => {
    it('should cleanup old sessions', async () => {
      repository.createSession('persona-1');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      const deleted = repository.cleanupOldSessions(5);
      expect(deleted).toBe(1);
      expect(repository.count()).toBe(0);
    });

    it('should cleanup expired sessions', () => {
      const session = repository.createSession('persona-1');
      repository.setExpiration(session.id, Date.now() - 1000); // Already expired

      const deleted = repository.cleanupExpiredSessions();
      expect(deleted).toBe(1);
    });
  });

  describe('getRecentTurns', () => {
    it('should return recent turns in chronological order', () => {
      const session = repository.createSession('persona-1');

      for (let i = 1; i <= 5; i++) {
        repository.addTurn(session.id, {
          id: `turn-${i}`,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      const recentTurns = repository.getRecentTurns(session.id, 3);
      expect(recentTurns).toHaveLength(3);
      expect(recentTurns[0].content).toBe('Message 3');
      expect(recentTurns[1].content).toBe('Message 4');
      expect(recentTurns[2].content).toBe('Message 5');
    });
  });

  describe('pruneOldTurns', () => {
    it('should keep only recent N turns', () => {
      const session = repository.createSession('persona-1');

      for (let i = 1; i <= 10; i++) {
        repository.addTurn(session.id, {
          id: `turn-${i}`,
          role: 'user',
          content: `Message ${i}`,
          timestamp: Date.now() + i,
        });
      }

      const pruned = repository.pruneOldTurns(session.id, 3);
      expect(pruned).toBe(7);

      const retrieved = repository.getSession(session.id);
      expect(retrieved!.turns).toHaveLength(3);
    });
  });
});
