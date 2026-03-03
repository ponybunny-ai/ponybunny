import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import type { SessionSummary } from '../../store/types.js';

function fmtTs(ms?: number): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function renderHighlighted(text: string, query: string): React.ReactNode {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <Text>{text}</Text>;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const parts: React.ReactNode[] = [];
  let start = 0;
  let idx = lowerText.indexOf(lowerQuery, start);
  let key = 0;

  while (idx !== -1) {
    if (idx > start) {
      parts.push(<Text key={`n-${key++}`}>{text.slice(start, idx)}</Text>);
    }
    parts.push(
      <Text key={`h-${key++}`} color="yellow">
        {text.slice(idx, idx + normalizedQuery.length)}
      </Text>
    );
    start = idx + normalizedQuery.length;
    idx = lowerText.indexOf(lowerQuery, start);
  }

  if (start < text.length) {
    parts.push(<Text key={`n-${key++}`}>{text.slice(start)}</Text>);
  }

  return <>{parts}</>;
}

export const SessionsView: React.FC = () => {
  const {
    state,
    setActiveSession,
    setSessions,
    setSessionsViewState,
    setSessionHistoryPreview,
    clearSessionHistoryPreview,
    addEvent,
    setView,
  } = useAppContext();
  const gateway = useGatewayContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const sortMode = state.sessionsSortMode;
  const lifecycleFilter = state.sessionsLifecycleFilter;
  const searchQuery = state.sessionsSearchQuery;

  const refreshSessions = useCallback(async (
    filter: 'active' | 'archived',
    options?: { focusSessionId?: string; preserveSelectionId?: string }
  ): Promise<SessionSummary[]> => {
    const client = gateway.client;
    if (!client) return [];
    setLoading(true);
    try {
      const result = await client.listConversationSessions({ limit: 20, lifecycleState: filter });
      const normalized = result.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        state: session.state,
        lifecycleState: session.lifecycleState,
        archivedAt: session.archivedAt,
        archiveSummary: session.archiveSummary,
        turnCount: session.turnCount,
        lastMessage: session.lastMessage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }));

      let nextIndex = 0;
      if (options?.focusSessionId) {
        const focused = normalized.findIndex((session) => session.id === options.focusSessionId);
        nextIndex = focused >= 0 ? focused : 0;
      } else if (options?.preserveSelectionId) {
        const preserved = normalized.findIndex((session) => session.id === options.preserveSelectionId);
        nextIndex = preserved >= 0 ? preserved : 0;
      }

      setSessions(normalized);
      setSelectedIndex(nextIndex);
      addEvent('conversation.sessions.loaded', {
        count: normalized.length,
        lifecycleState: filter,
        source: 'sessions_view',
      });
      return normalized;
    } finally {
      setLoading(false);
    }
  }, [addEvent, gateway.client, setSessions]);

  const sessions = useMemo(() => {
    const copy = [...state.sessions];
    if (sortMode === 'history_freshness') {
      copy.sort((a, b) => {
        const aFresh = state.sessionHistoryPreviews[a.id]?.generatedAt ?? 0;
        const bFresh = state.sessionHistoryPreviews[b.id]?.generatedAt ?? 0;
        if (bFresh !== aFresh) return bFresh - aFresh;
        return b.updatedAt - a.updatedAt;
      });
      return copy;
    }
    copy.sort((a, b) => b.updatedAt - a.updatedAt);
    return copy;
  }, [sortMode, state.sessionHistoryPreviews, state.sessions]);

  const visibleSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => {
      const haystack = [
        session.title ?? '',
        session.id,
        session.lastMessage ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [searchQuery, sessions]);

  const selected = visibleSessions[selectedIndex];

  useEffect(() => {
    if (selectedIndex >= visibleSessions.length) {
      setSelectedIndex(Math.max(0, visibleSessions.length - 1));
    }
  }, [selectedIndex, visibleSessions.length]);

  useInput((input, key) => {
    if (state.activeModal || loading) return;

    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        return;
      }
      if (key.return) {
        setSearchMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSessionsViewState(undefined, searchQuery.slice(0, -1));
        setSelectedIndex(0);
        return;
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setSessionsViewState(undefined, `${searchQuery}${input}`);
        setSelectedIndex(0);
      }
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      return;
    }

    if (input === 'o') {
      setSessionsViewState(undefined, undefined, sortMode === 'updated' ? 'history_freshness' : 'updated');
      setSelectedIndex(0);
      return;
    }

    if (input === 'q' && !searchMode) {
      setSessionsViewState(undefined, '');
      setSelectedIndex(0);
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((idx) => Math.max(0, idx - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex((idx) => Math.min(visibleSessions.length - 1, idx + 1));
      return;
    }

    if ((key.return || input === 'u') && selected) {
      setActiveSession(selected.id, selected.title ?? null);
      addEvent('conversation.session.selected', {
        sessionId: selected.id,
        source: 'sessions_view',
      });
      return;
    }

    if (input === 'g' && selected) {
      setActiveSession(selected.id, selected.title ?? null);
      setView('goals');
      return;
    }

    if (input === 't' && selected) {
      setActiveSession(selected.id, selected.title ?? null);
      setView('tasks');
      return;
    }

    const runHistoryPreviewFetch = (roleFilter: 'all' | 'user' | 'assistant' | 'system') => {
      if (!selected) return;
      const client = gateway.client;
      if (!client) return;
      setLoading(true);
      void (async () => {
        try {
          const history = await client.getConversationHistory(selected.id, 20);
          const filteredTurns = roleFilter === 'all'
            ? history.turns
            : history.turns.filter((turn) => turn.role === roleFilter);
          const previewTurns = filteredTurns.slice(-8);
          const previewText = previewTurns
            .map((turn) => `${turn.role}: ${turn.content.replace(/\s+/g, ' ').slice(0, 140)}`)
            .join('\n');

          setActiveSession(selected.id, selected.title ?? null);
          setSessionHistoryPreview({
            sessionId: selected.id,
            totalTurns: history.turns.length,
            returnedTurns: filteredTurns.length,
            roleFilter,
            limit: 20,
            offset: 0,
            previewLines: 8,
            generatedAt: Date.now(),
            source: 'sessions_view',
            previewText: previewText || 'No turns in session history.',
          });
          addEvent('conversation.history.loaded', {
            sessionId: selected.id,
            total: history.turns.length,
            returned: filteredTurns.length,
            roleFilter,
            source: 'sessions_view',
          });
        } finally {
          setLoading(false);
        }
      })();
    };

    if (input === 'y' && selected) {
      runHistoryPreviewFetch('all');
      return;
    }

    if (input === '1' && selected) {
      runHistoryPreviewFetch('all');
      return;
    }

    if (input === '2' && selected) {
      runHistoryPreviewFetch('user');
      return;
    }

    if (input === '3' && selected) {
      runHistoryPreviewFetch('assistant');
      return;
    }

    if (input === '4' && selected) {
      runHistoryPreviewFetch('system');
      return;
    }

    if (input === 'z' && selected) {
      clearSessionHistoryPreview(selected.id);
      addEvent('conversation.history.preview.cleared', {
        sessionId: selected.id,
        source: 'sessions_view',
      });
      return;
    }

    if (input === 'm' && selected && state.sessionHistoryPreviews[selected.id]) {
      setPreviewExpanded((prev) => !prev);
      return;
    }

    if (input === 'a') {
      if (lifecycleFilter !== 'active') {
        setSessionsViewState('active');
        void refreshSessions('active', { preserveSelectionId: selected?.id });
      }
      return;
    }

    if (input === 'h') {
      if (lifecycleFilter !== 'archived') {
        setSessionsViewState('archived');
        void refreshSessions('archived', { preserveSelectionId: selected?.id });
      }
      return;
    }

    if (input === 'x' && selected) {
      const client = gateway.client;
      if (!client) return;
      setLoading(true);
      void (async () => {
        try {
          const result = await client.archiveConversationSession(selected.id);
          if (result.success) {
            if (state.activeSessionId === selected.id) {
              setActiveSession(null, null);
            }
            addEvent('conversation.archived', { sessionId: selected.id, source: 'sessions_view' });
            await refreshSessions(lifecycleFilter, { preserveSelectionId: selected.id });
          }
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    if (input === 'v' && selected) {
      const client = gateway.client;
      if (!client) return;
      setLoading(true);
      void (async () => {
        try {
          const resumedSessionId = selected.id;
          const result = await client.resumeConversationSession(selected.id);
          if (result.success) {
            addEvent('conversation.resumed', { sessionId: selected.id, source: 'sessions_view' });
            const refreshed =
              lifecycleFilter !== 'active'
                ? await refreshSessions('active', { focusSessionId: resumedSessionId })
                : await refreshSessions('active', { focusSessionId: resumedSessionId });
            if (lifecycleFilter !== 'active') {
              setSessionsViewState('active');
            }
            const resumed = refreshed.find((session) => session.id === resumedSessionId);
            setActiveSession(resumedSessionId, resumed?.title ?? null);
          }
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    if (input === 'r') {
      void refreshSessions(lifecycleFilter, { preserveSelectionId: selected?.id });
    }
  });

  if (visibleSessions.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Text bold color="cyan">Sessions</Text>
        <Box marginTop={1}>
          <Text dimColor>
            {searchQuery ? `No results for "${searchQuery}".` : 'No sessions loaded. Run /sessions to fetch recent sessions.'}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" width="46%" borderStyle="round" borderColor="gray" paddingX={1} marginRight={1}>
        <Text bold color="cyan">Session List ({visibleSessions.length}/{sessions.length})</Text>
        <Text dimColor>
          Filter: {lifecycleFilter} · sort={sortMode} (o toggle) · / search · q clear-search · a active · h archived · j/k select · Enter/u activate · g goals · t workstream · y/1..4 history-role · m expand/collapse preview · z clear-history-preview · x archive · v resume · r refresh
        </Text>
        <Text dimColor>
          Search: {searchMode ? 'editing' : 'idle'}{searchQuery ? ` · "${searchQuery}"` : ' · (empty)'}
        </Text>
        <Box marginTop={1} flexDirection="column">
          {visibleSessions.map((session, idx) => {
            const active = idx === selectedIndex;
            const current = state.activeSessionId === session.id;
            return (
              <Box key={session.id}>
                <Text color={active ? 'cyan' : undefined}>{active ? '>' : ' '}{current ? '*' : ' '} </Text>
                <Text dimColor={!active}>
                  {renderHighlighted(`${(session.title || session.id).slice(0, 40)} [${session.state}] (${session.turnCount} turns)`, searchQuery)}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" width="54%" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">Session Detail</Text>
        {selected && (
          <>
            <Text>- Session ID: {selected.id}</Text>
            <Text>- Title: {selected.title || '-'}</Text>
            <Text>- State: {selected.state}</Text>
            <Text>- Lifecycle: {selected.lifecycleState}</Text>
            {selected.archivedAt ? <Text>- Archived: {fmtTs(selected.archivedAt)}</Text> : null}
            <Text>- Turns: {selected.turnCount}</Text>
            <Text>- Created: {fmtTs(selected.createdAt)}</Text>
            <Text>- Updated: {fmtTs(selected.updatedAt)}</Text>
            {selected.archiveSummary ? (
              <Box marginTop={1} flexDirection="column">
                <Text bold>Archive Summary</Text>
                <Text dimColor>{selected.archiveSummary}</Text>
              </Box>
            ) : null}
            <Box marginTop={1} flexDirection="column">
              <Text bold>Last Message</Text>
              <Text dimColor>{selected.lastMessage || '-'}</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                {state.activeSessionId === selected.id
                  ? 'This is the active session.'
                  : 'Press Enter (or u) to activate this session.'}
              </Text>
            </Box>
            {state.sessionHistoryPreviews[selected.id] ? (
              <Box marginTop={1} flexDirection="column">
                <Text bold>History Preview</Text>
                <Text dimColor>
                  role={state.sessionHistoryPreviews[selected.id].roleFilter} · turns={state.sessionHistoryPreviews[selected.id].returnedTurns}/{state.sessionHistoryPreviews[selected.id].totalTurns} · limit={state.sessionHistoryPreviews[selected.id].limit} · offset={state.sessionHistoryPreviews[selected.id].offset} · source={state.sessionHistoryPreviews[selected.id].source} · at {fmtTs(state.sessionHistoryPreviews[selected.id].generatedAt)}
                </Text>
                <Text dimColor>
                  {previewExpanded
                    ? state.sessionHistoryPreviews[selected.id].previewText
                    : state.sessionHistoryPreviews[selected.id].previewText.split('\n').slice(0, state.sessionHistoryPreviews[selected.id].previewLines).join('\n')}
                </Text>
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Box>
  );
};
