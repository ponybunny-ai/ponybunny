/**
 * DashboardView - Main dashboard showing active goals and recent events
 */

import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { useGateway } from '../../hooks/use-gateway.js';
import { useGoals } from '../../hooks/use-goals.js';
import { GoalCard } from '../widgets/goal-card.js';
import { EventItem } from '../widgets/event-item.js';

export const DashboardView: React.FC = () => {
  const { state } = useAppContext();
  const { refreshGoals, refreshEscalations, isConnected } = useGateway();
  const { activeGoals, queuedGoals } = useGoals();
  const { events, pendingEscalationCount } = state;

  // Load data on mount
  useEffect(() => {
    if (isConnected) {
      refreshGoals();
      refreshEscalations();
    }
  }, [isConnected, refreshGoals, refreshEscalations]);

  const recentEvents = events.slice(-5);
  const displayGoals = [...activeGoals, ...queuedGoals].slice(0, 5);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Active Goals Section */}
      <Box flexDirection="column" marginBottom={1}>
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold color="cyan">Active Goals</Text>
          <Box marginTop={1} flexDirection="column">
            {displayGoals.length === 0 ? (
              <Text dimColor>No active goals. Type a goal description or use /new to create one.</Text>
            ) : (
              displayGoals.map(goal => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  compact
                  workItemStats={{ completed: 0, total: 0 }}
                />
              ))
            )}
          </Box>
        </Box>
      </Box>

      {/* Recent Events Section */}
      <Box flexDirection="column" marginBottom={1}>
        <Box
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold color="cyan">Recent Events</Text>
          <Box marginTop={1} flexDirection="column">
            {recentEvents.length === 0 ? (
              <Text dimColor>No events yet. Events will appear here as work progresses.</Text>
            ) : (
              recentEvents.map(event => (
                <EventItem key={event.id} event={event} compact />
              ))
            )}
          </Box>
        </Box>
      </Box>

      {/* Pending Items */}
      {pendingEscalationCount > 0 && (
        <Box paddingX={1}>
          <Text color="yellow">
            ⚠ Pending: {pendingEscalationCount} escalation{pendingEscalationCount !== 1 ? 's' : ''} need{pendingEscalationCount === 1 ? 's' : ''} attention
          </Text>
        </Box>
      )}
    </Box>
  );
};
