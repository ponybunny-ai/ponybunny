export interface SessionCommandMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isCommand?: boolean;
}

export interface LocalConversationSession {
  id: string;
  messages: SessionCommandMessage[];
  createdAt: number;
  updatedAt: number;
  lifecycleState: 'active' | 'archived';
  archivedAt?: number;
  archiveSummary?: string;
}

export function createLocalSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function summarizeSessionForArchive(messages: SessionCommandMessage[]): string {
  const conversationMessages = messages.filter(
    (message) => !message.isCommand && (message.role === 'user' || message.role === 'assistant')
  );

  if (conversationMessages.length === 0) {
    return 'Archived empty session.';
  }

  const userMessages = conversationMessages.filter((message) => message.role === 'user');
  const assistantMessages = conversationMessages.filter((message) => message.role === 'assistant');

  const firstUser = userMessages[0]?.content.slice(0, 120);
  const lastUser = userMessages[userMessages.length - 1]?.content.slice(0, 120);
  const lastAssistant = assistantMessages[assistantMessages.length - 1]?.content.slice(0, 120);

  const parts = [
    `Archived after ${conversationMessages.length} conversation messages.`,
    firstUser ? `Started with: ${firstUser}` : undefined,
    lastUser ? `Last user: ${lastUser}` : undefined,
    lastAssistant ? `Last assistant: ${lastAssistant}` : undefined,
  ].filter((part): part is string => !!part);

  return parts.join(' ');
}

export function listResumableSessions(
  sessions: Record<string, LocalConversationSession>,
  activeSessionId: string
): LocalConversationSession[] {
  return Object.values(sessions)
    .filter((session) => session.id !== activeSessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function resolveResumeTarget(
  selection: string | undefined,
  sessions: Record<string, LocalConversationSession>,
  activeSessionId: string
): LocalConversationSession | null {
  const resumable = listResumableSessions(sessions, activeSessionId);
  if (resumable.length === 0) {
    return null;
  }

  if (!selection || selection.trim().length === 0 || selection === 'latest') {
    return resumable[0] ?? null;
  }

  const normalized = selection.trim();
  const index = Number(normalized);
  if (Number.isInteger(index) && index > 0 && index <= resumable.length) {
    return resumable[index - 1] ?? null;
  }

  const exact = resumable.find((session) => session.id === normalized);
  if (exact) {
    return exact;
  }

  return resumable.find((session) => session.id.startsWith(normalized)) ?? null;
}
