/**
 * DashboardView - Unified main view (summary + message stream)
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGoals } from '../../hooks/use-goals.js';
import { SimpleMessageItem } from '../widgets/simple-message-item.js';

export const DashboardView: React.FC = () => {
  const { state } = useAppContext();
  const { activeGoals, queuedGoals, completedGoals } = useGoals();
  const { pendingEscalationCount, simpleMessages, workItems } = state;

  const hasMessages = simpleMessages.length > 0;
  const activeWorkItems = workItems.filter(item =>
    item.status === 'in_progress' || item.status === 'ready' || item.status === 'queued'
  );

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
            {simpleMessages.map(message => (
              <SimpleMessageItem key={message.id} message={message} />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};
