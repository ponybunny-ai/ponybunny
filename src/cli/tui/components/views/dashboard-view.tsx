/**
 * DashboardView - Unified main view (summary + message stream)
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGatewayContext } from '../../context/gateway-context.js';
import { useGoals } from '../../hooks/use-goals.js';
import { useTerminalSize } from '../../hooks/use-terminal-size.js';
import { formatDateTime, truncateDisplayWidth } from '../../utils/formatters.js';
import { renderMarkdownToTerminalLines } from '../../utils/markdown-render.js';
import { resolveConversationRenderState } from '../../utils/conversation-render-state.js';
import { resolvePendingConversationState } from '../../utils/conversation-pending-state.js';

type ConversationTurn = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
};

type DisplayConversationTurn = ConversationTurn & {
  pendingSyncState?: 'awaiting_reply' | 'syncing_history' | 'failed';
  pendingStatusText?: string;
  pendingError?: string;
};

type RenderedConversationLine = {
  key: string;
  text: string;
  color?: 'green' | 'blue' | 'yellow' | 'gray' | 'red';
  dim?: boolean;
  bold?: boolean;
};

export const DashboardView: React.FC = () => {
  const { state } = useAppContext();
  const gateway = useGatewayContext();
  const { activeGoals, queuedGoals, completedGoals } = useGoals();
  const {
    pendingEscalationCount,
    workItems,
    sessions,
    activeSessionId,
    sessionsLifecycleFilter,
    sessionsSearchQuery,
    sessionsSortMode,
    sessionHistoryPreviews,
    eventsFilter,
    eventsSearchQuery,
    events,
    simpleMessages,
  } = state;
  const { rows, columns } = useTerminalSize();

  const activeSession = React.useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );
  const [conversationTurns, setConversationTurns] = React.useState<ConversationTurn[]>([]);
  const [conversationLoading, setConversationLoading] = React.useState(false);
  const [conversationError, setConversationError] = React.useState<string | null>(null);

  const confirmedConversationTurns = React.useMemo<ConversationTurn[]>(
    () => [...conversationTurns].sort((a, b) => a.timestamp - b.timestamp),
    [conversationTurns]
  );
  const pendingConversationState = React.useMemo(
    () => resolvePendingConversationState({
      activeSessionId,
      simpleMessages,
      conversationTurns: confirmedConversationTurns,
    }),
    [activeSessionId, confirmedConversationTurns, simpleMessages]
  );
  const displayConversationTurns = React.useMemo<DisplayConversationTurn[]>(() => {
    const baseTurns = confirmedConversationTurns.map((turn) => ({ ...turn }));
    if (!pendingConversationState) {
      return baseTurns;
    }

    return [
      ...baseTurns,
      {
        role: 'user' as const,
        content: pendingConversationState.input,
        timestamp: pendingConversationState.timestamp,
        pendingSyncState: pendingConversationState.syncState,
        pendingStatusText: pendingConversationState.statusText,
        pendingError: pendingConversationState.error,
      },
    ].sort((a, b) => a.timestamp - b.timestamp);
  }, [confirmedConversationTurns, pendingConversationState]);

  const activeWorkItems = workItems.filter(item =>
    item.status === 'in_progress' || item.status === 'ready' || item.status === 'queued'
  );
  const summaryTextWidth = Math.max(12, Math.floor(columns / 6));
  const compactSummaryLayout = columns < 110;
  const layoutGap = 1;
  const panelLeftWidth = Math.max(24, Math.floor(columns * 0.24));
  const panelCenterWidth = Math.max(34, Math.floor(columns * 0.44));
  const panelRightWidth = Math.max(
    24,
    columns - panelLeftWidth - panelCenterWidth - layoutGap * 2 - 2
  );
  const streamTextWidth = Math.max(20, columns - 8);
  const renderedConversationLines = React.useMemo<RenderedConversationLine[]>(() => {
    const lines: RenderedConversationLine[] = [];

    for (const [turnIndex, turn] of displayConversationTurns.entries()) {
      const role = turn.role.toUpperCase();
      const roleColor = turn.role === 'assistant'
        ? 'blue'
        : turn.role === 'system'
          ? 'yellow'
          : 'green';
      const pendingLabel = turn.pendingSyncState === 'awaiting_reply'
        ? ' · sending'
        : turn.pendingSyncState === 'syncing_history'
          ? ' · syncing'
          : turn.pendingSyncState === 'failed'
            ? ' · failed'
            : '';

      lines.push({
        key: `${turn.timestamp}-${turnIndex}-header`,
        text: `${role} · ${formatDateTime(turn.timestamp)}${pendingLabel}`,
        color: turn.pendingSyncState === 'failed' ? 'red' : roleColor,
        bold: true,
      });

      const normalizedContent = turn.content.trim().length > 0 ? turn.content : '(empty)';
      const wrappedContentAll = renderMarkdownToTerminalLines(normalizedContent, streamTextWidth);
      for (let index = 0; index < wrappedContentAll.length; index += 1) {
        lines.push({
          key: `${turn.timestamp}-${turnIndex}-content-${index}`,
          text: `  ${wrappedContentAll[index]}`,
          dim: turn.pendingSyncState === 'awaiting_reply' || turn.pendingSyncState === 'syncing_history',
        });
      }

      if (turn.pendingSyncState) {
        const pendingDetail = turn.pendingSyncState === 'failed'
          ? turn.pendingError || 'Conversation failed'
          : turn.pendingSyncState === 'syncing_history'
            ? 'Assistant replied. Syncing conversation history...'
            : turn.pendingStatusText || 'Waiting for assistant reply...';
        lines.push({
          key: `${turn.timestamp}-${turnIndex}-pending-status`,
          text: `  [${turn.pendingSyncState === 'failed' ? 'Error' : 'Pending'}] ${pendingDetail}`,
          color: turn.pendingSyncState === 'failed' ? 'yellow' : 'gray',
          dim: turn.pendingSyncState !== 'failed',
        });
      }

      lines.push({
        key: `${turn.timestamp}-${turnIndex}-spacer`,
        text: '',
        dim: true,
      });
    }

    return lines;
  }, [displayConversationTurns, streamTextWidth]);
  const conversationRenderState = resolveConversationRenderState({
    activeSessionId,
    mergedTurnCount: displayConversationTurns.length,
    conversationLoading,
    conversationError,
  });
  const summaryRows = compactSummaryLayout ? 32 : 14;
  const pendingBannerRows = pendingEscalationCount > 0 ? 4 : 0;
  const conversationChromeRows = pendingConversationState ? 6 : 4;
  const layoutReserveRows = 8;
  const usableRows = Math.max(8, rows - layoutReserveRows);
  const maxVisibleLines = Math.max(4, usableRows - summaryRows - pendingBannerRows - conversationChromeRows);
  const [lineScrollOffset, setLineScrollOffset] = React.useState(0);
  const maxLineScrollOffset = Math.max(0, renderedConversationLines.length - maxVisibleLines);
  const clampedLineOffset = Math.min(lineScrollOffset, maxLineScrollOffset);
  const visibleLineEnd = Math.max(0, renderedConversationLines.length - clampedLineOffset);
  const visibleLineStart = Math.max(0, visibleLineEnd - maxVisibleLines);
  const visibleConversationLines = renderedConversationLines.slice(visibleLineStart, visibleLineEnd);
  const paddedConversationLines = React.useMemo(() => {
    if (visibleConversationLines.length >= maxVisibleLines) {
      return visibleConversationLines;
    }

    const fillerCount = maxVisibleLines - visibleConversationLines.length;
    const fillers: RenderedConversationLine[] = Array.from({ length: fillerCount }, (_value, index) => ({
      key: `filler-${index}`,
      text: '',
      dim: true,
    }));
    return [...visibleConversationLines, ...fillers];
  }, [maxVisibleLines, visibleConversationLines]);
  const latestHistoryPreview = Object.values(sessionHistoryPreviews)
    .sort((a, b) => b.generatedAt - a.generatedAt)[0];
  const latestConversationEventId = React.useMemo(() => {
    if (!activeSessionId || events.length === 0) {
      return null;
    }

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.event !== 'conversation.new' && event.event !== 'conversation.response') {
        continue;
      }

      const data = event.data as { sessionId?: unknown } | undefined;
      if (typeof data?.sessionId === 'string' && data.sessionId === activeSessionId) {
        return event.id;
      }
    }

    return null;
  }, [activeSessionId, events]);

  const pendingConversationStatus = React.useMemo(() => {
    if (!pendingConversationState) {
      return null;
    }

    if (pendingConversationState.syncState === 'failed') {
      return {
        color: 'red' as const,
        prefix: 'Conversation failed',
        detail: pendingConversationState.error || 'Unknown error',
      };
    }

    if (pendingConversationState.syncState === 'syncing_history') {
      return {
        color: 'yellow' as const,
        prefix: 'Reply received',
        detail: 'Syncing conversation history...',
      };
    }

    return {
      color: 'yellow' as const,
      prefix: pendingConversationState.statusText || 'Waiting for assistant reply',
      detail: truncateDisplayWidth(pendingConversationState.input, Math.max(24, streamTextWidth - 12)),
    };
  }, [pendingConversationState, streamTextWidth]);

  React.useEffect(() => {
    if (lineScrollOffset > maxLineScrollOffset) {
      setLineScrollOffset(maxLineScrollOffset);
    }
  }, [maxLineScrollOffset, lineScrollOffset]);

  React.useEffect(() => {
    if (!activeSessionId) {
      setConversationTurns([]);
      setConversationError(null);
      setConversationLoading(false);
      setLineScrollOffset(0);
      return;
    }

    const client = gateway.client;
    if (!client) {
      setConversationError('Gateway not connected yet.');
      setConversationTurns([]);
      setConversationLoading(false);
      setLineScrollOffset(0);
      return;
    }

    let cancelled = false;
    setConversationLoading(true);
    setConversationError(null);

    const limit = Math.min(Math.max(activeSession?.turnCount ?? 20, 20), 500);
    void client.getConversationHistory(activeSessionId, limit)
      .then((history) => {
        if (cancelled) {
          return;
        }
        const orderedTurns = [...history.turns].sort((a, b) => a.timestamp - b.timestamp);
        setConversationTurns(orderedTurns);
      })
      .catch((error: Error) => {
        if (cancelled) {
          return;
        }
        setConversationTurns([]);
        setConversationError(error.message);
      })
      .finally(() => {
        if (!cancelled) {
          setConversationLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession?.turnCount, activeSessionId, gateway.client, latestConversationEventId]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setLineScrollOffset((value) => Math.min(maxLineScrollOffset, value + 1));
      return;
    }

    if (key.downArrow) {
      setLineScrollOffset((value) => Math.max(0, value - 1));
      return;
    }

    if (key.pageUp) {
      setLineScrollOffset((value) => Math.min(maxLineScrollOffset, value + Math.max(3, maxVisibleLines - 2)));
      return;
    }

    if (key.pageDown) {
      setLineScrollOffset((value) => Math.max(0, value - Math.max(3, maxVisibleLines - 2)));
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Pending Items */}
      {pendingEscalationCount > 0 && (
        <Box
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginBottom={1}
        >
          <Text color="yellow">
            ⚠ {pendingEscalationCount} item(s) need your confirmation (type /escalations to view)
          </Text>
        </Box>
      )}

      {/* Summary Row */}
      <Box flexDirection={compactSummaryLayout ? 'column' : 'row'} marginBottom={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginRight={compactSummaryLayout ? 0 : layoutGap}
          marginBottom={compactSummaryLayout ? 1 : 0}
          width={compactSummaryLayout ? undefined : panelLeftWidth}
        >
          <Text bold color="cyan">Goals</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Active: {activeGoals.length}</Text>
            <Text dimColor>Queued: {queuedGoals.length}</Text>
            <Text dimColor>Completed: {completedGoals.length}</Text>
          </Box>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginBottom={compactSummaryLayout ? 1 : 0}
          width={compactSummaryLayout ? undefined : panelCenterWidth}
        >
          <Text bold color="cyan">Session Overview</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor wrap="truncate-end">Active session: {activeSessionId ? activeSessionId.slice(0, 24) : 'none'}</Text>
            <Text dimColor wrap="truncate-end">Title: {truncateDisplayWidth(activeSession?.title ?? '(untitled)', summaryTextWidth + 8)}</Text>
            <Text dimColor>Turn count: {activeSession?.turnCount ?? 0}</Text>
            <Text dimColor wrap="truncate-end">Lifecycle: {activeSession?.lifecycleState ?? 'n/a'}</Text>
            <Text dimColor wrap="truncate-end">Status: {conversationLoading ? 'loading history...' : conversationError ? `error: ${conversationError}` : 'ready'}</Text>
          </Box>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginLeft={compactSummaryLayout ? 0 : layoutGap}
          width={compactSummaryLayout ? undefined : panelRightWidth}
        >
          <Text bold color="cyan">Workstream</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Active WIs: {activeWorkItems.length}</Text>
            {activeWorkItems.length === 0 ? (
              <Text dimColor>No active work items yet.</Text>
            ) : (
              activeWorkItems.slice(0, 4).map(item => (
                <Text key={item.id} dimColor>
                  • {truncateDisplayWidth(item.title, summaryTextWidth + 10)} ({item.status})
                </Text>
              ))
            )}
            <Text dimColor wrap="truncate-end">Sessions: {sessions.length} · {sessionsLifecycleFilter} · {sessionsSortMode}</Text>
            <Text dimColor wrap="truncate-end">Search: {sessionsSearchQuery || '(empty)'}</Text>
            <Text dimColor wrap="truncate-end">Last history preview: {latestHistoryPreview ? latestHistoryPreview.sessionId.slice(0, 10) : 'none'}</Text>
            <Text dimColor wrap="truncate-end">Events: {eventsFilter}{eventsSearchQuery ? ` · q=${eventsSearchQuery}` : ''}</Text>
          </Box>
        </Box>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {conversationRenderState === 'no-session' ? (
          <Box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <Box marginBottom={1}>
              <Text bold color="cyan">PonyBunny</Text>
            </Box>
            <Text dimColor>Select or create a session to view conversation history.</Text>
          </Box>
        ) : conversationRenderState === 'loading' ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text dimColor>
              {pendingConversationState
                ? 'Waiting for assistant reply...'
                : 'Loading session conversation...'}
            </Text>
          </Box>
        ) : conversationRenderState === 'error' ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Text color="red">Failed to load conversation: {conversationError}</Text>
          </Box>
        ) : conversationRenderState === 'empty' ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1} flexDirection="column">
            {pendingConversationStatus ? (
              <>
                <Text color={pendingConversationStatus.color}>{pendingConversationStatus.prefix}</Text>
                <Text dimColor wrap="truncate-end">{pendingConversationStatus.detail}</Text>
              </>
            ) : (
              <Text dimColor>Current session has no conversation turns yet.</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="column" flexGrow={1} paddingX={1}>
            <Text dimColor>
              Conversation lines {visibleLineStart + 1}-{visibleLineEnd} / {renderedConversationLines.length} · full markdown · wheel/↑↓/PgUp/PgDn scroll
            </Text>
            {pendingConversationStatus ? (
              <Text color={pendingConversationStatus.color}>
                {pendingConversationStatus.prefix}: <Text dimColor>{pendingConversationStatus.detail}</Text>
              </Text>
            ) : null}
            <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column" height={maxVisibleLines + 2}>
              {paddedConversationLines.map((line) => (
                <Text
                  key={line.key}
                  color={line.color}
                  dimColor={line.dim}
                  bold={line.bold}
                  wrap="truncate-end"
                >
                  {line.text}
                </Text>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
