import {
  listResumableSessions,
  resolveResumeTarget,
  summarizeSessionForArchive,
  type LocalConversationSession,
} from '../../src/cli/ui/session-lifecycle.js';

function session(id: string, updatedAt: number, lifecycleState: 'active' | 'archived'): LocalConversationSession {
  return {
    id,
    messages: [
      { role: 'user', content: `hello from ${id}` },
      { role: 'assistant', content: `response for ${id}` },
    ],
    createdAt: updatedAt - 100,
    updatedAt,
    lifecycleState,
  };
}

describe('session lifecycle utils', () => {
  it('summarizes archived sessions from user and assistant turns', () => {
    const summary = summarizeSessionForArchive([
      { role: 'system', content: 'meta', isCommand: true },
      { role: 'user', content: 'Build a plan for release rollout' },
      { role: 'assistant', content: 'I will create a staged rollout plan' },
      { role: 'user', content: 'Also include risk mitigation' },
    ]);

    expect(summary).toContain('Archived after 3 conversation messages');
    expect(summary).toContain('Started with: Build a plan for release rollout');
    expect(summary).toContain('Last user: Also include risk mitigation');
  });

  it('lists resumable sessions ordered by updatedAt and excludes active session', () => {
    const sessions = {
      s1: session('s1', 100, 'active'),
      s2: session('s2', 200, 'archived'),
      s3: session('s3', 150, 'active'),
    };

    const resumable = listResumableSessions(sessions, 's1');
    expect(resumable.map((item) => item.id)).toEqual(['s2', 's3']);
  });

  it('resolves resume target by latest, index, full id, and prefix', () => {
    const sessions = {
      'session-a111': session('session-a111', 100, 'active'),
      'session-b222': session('session-b222', 200, 'archived'),
      'session-c333': session('session-c333', 150, 'active'),
    };

    expect(resolveResumeTarget(undefined, sessions, 'session-a111')?.id).toBe('session-b222');
    expect(resolveResumeTarget('latest', sessions, 'session-a111')?.id).toBe('session-b222');
    expect(resolveResumeTarget('2', sessions, 'session-a111')?.id).toBe('session-c333');
    expect(resolveResumeTarget('session-c333', sessions, 'session-a111')?.id).toBe('session-c333');
    expect(resolveResumeTarget('session-b', sessions, 'session-a111')?.id).toBe('session-b222');
    expect(resolveResumeTarget('missing', sessions, 'session-a111')).toBeNull();
  });
});
