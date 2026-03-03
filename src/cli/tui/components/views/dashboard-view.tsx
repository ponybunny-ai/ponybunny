/**
 * DashboardView - Unified main view (summary + message stream)
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGoals } from '../../hooks/use-goals.js';
import { useTerminalSize } from '../../hooks/use-terminal-size.js';
import { SimpleMessageItem } from '../widgets/simple-message-item.js';

export const DashboardView: React.FC = () => {
  const { state } = useAppContext();
  const { activeGoals, queuedGoals, completedGoals } = useGoals();
  const {
    pendingEscalationCount,
    simpleMessages,
    workItems,
    sessions,
    activeSessionId,
    sessionsLifecycleFilter,
    sessionsSearchQuery,
    sessionsSortMode,
    sessionHistoryPreviews,
    eventsFilter,
    eventsSearchQuery,
  } = state;
  const { rows } = useTerminalSize();

  const hasMessages = simpleMessages.length > 0;
  const activeWorkItems = workItems.filter(item =>
    item.status === 'in_progress' || item.status === 'ready' || item.status === 'queued'
  );
  const maxVisibleMessages = Math.max(2, Math.floor((rows - 14) / 3));
  const [messageScrollOffset, setMessageScrollOffset] = React.useState(0);
  const maxMessageScrollOffset = Math.max(0, simpleMessages.length - maxVisibleMessages);
  const clampedOffset = Math.min(messageScrollOffset, maxMessageScrollOffset);
  const visibleRangeEnd = Math.max(0, simpleMessages.length - clampedOffset);
  const visibleRangeStart = Math.max(0, visibleRangeEnd - maxVisibleMessages);
  const visibleMessages = simpleMessages.slice(visibleRangeStart, visibleRangeEnd);
  const latestHistoryPreview = Object.values(sessionHistoryPreviews)
    .sort((a, b) => b.generatedAt - a.generatedAt)[0];

  React.useEffect(() => {
    if (messageScrollOffset > maxMessageScrollOffset) {
      setMessageScrollOffset(maxMessageScrollOffset);
    }
  }, [maxMessageScrollOffset, messageScrollOffset]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setMessageScrollOffset((value) => Math.min(maxMessageScrollOffset, value + 1));
      return;
    }

    if (key.downArrow) {
      setMessageScrollOffset((value) => Math.max(0, value - 1));
    }
  });

  React.useEffect(() => {
    const stdin = process.stdin;
    if (!stdin?.isTTY) {
      return;
    }

    stdin.write('\u001b[?1000h\u001b[?1006h');
    const onData = (chunk: Buffer | string) => {
      const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const match = data.match(/\u001b\[<(\d+);(\d+);(\d+)([mM])/);
      if (!match || match[4] !== 'M') {
        return;
      }

      const button = Number.parseInt(match[1], 10);
      if (button === 64) {
        setMessageScrollOffset((value) => Math.min(maxMessageScrollOffset, value + 1));
      } else if (button === 65) {
        setMessageScrollOffset((value) => Math.max(0, value - 1));
      }
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      stdin.write('\u001b[?1000l\u001b[?1006l');
    };
  }, [maxMessageScrollOffset]);

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
      <Box flexDirection="row" marginBottom={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginRight={2}
          flexGrow={1}
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
          flexGrow={2}
        >
          <Text bold color="cyan">Current Work Items</Text>
          <Box marginTop={1} flexDirection="column">
            {activeWorkItems.length === 0 ? (
              <Text dimColor>No active work items yet.</Text>
            ) : (
              activeWorkItems.slice(0, 4).map(item => (
                <Text key={item.id} dimColor>
                  • {item.title} ({item.status})
                </Text>
              ))
            )}
          </Box>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginLeft={2}
          flexGrow={1}
        >
          <Text bold color="cyan">Sessions</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Loaded: {sessions.length}</Text>
            <Text dimColor>Active: {activeSessionId ? activeSessionId.slice(0, 12) : 'none'}</Text>
            <Text dimColor>Filter: {sessionsLifecycleFilter}</Text>
            <Text dimColor>Search: {sessionsSearchQuery || '(empty)'}</Text>
            <Text dimColor>Sort: {sessionsSortMode}</Text>
            <Text dimColor>
              Last history: {latestHistoryPreview
                ? `${latestHistoryPreview.sessionId.slice(0, 10)} role=${latestHistoryPreview.roleFilter}`
                : 'none'}
            </Text>
            <Text dimColor>Events: {eventsFilter}{eventsSearchQuery ? ` · q=${eventsSearchQuery}` : ''}</Text>
            <Text dimColor>Drill-down: Sessions -&gt; Goals -&gt; Workstream -&gt; Runs</Text>
          </Box>
        </Box>
      </Box>

      {/* Message Stream */}
      <Box flexDirection="column" flexGrow={1}>
        {!hasMessages ? (
          <Box
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            flexGrow={1}
          >
            <Box marginBottom={1}>
              <Text bold color="cyan">PonyBunny</Text>
            </Box>
            <Text dimColor>Enter your request and I'll help you get it done</Text>
          </Box>
        ) : (
          <Box flexDirection="column" flexGrow={1} paddingX={1}>
            <Text dimColor>
              Stream {visibleRangeStart + 1}-{visibleRangeEnd} / {simpleMessages.length} · wheel or ↑/↓ scroll
            </Text>
            {visibleMessages.map(message => (
              <SimpleMessageItem key={message.id} message={message} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};
