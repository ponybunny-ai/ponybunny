/**
 * Overview View - Dashboard showing system summary
 */

import * as React from 'react';
import { Box, Text } from 'ink';
import { useDebugContext } from '../context.js';

// ============================================================================
// Lane Card Component
// ============================================================================

const LaneCard: React.FC<{ laneId: string; active: number; queued: number; available: boolean }> = ({
  laneId,
  active,
  queued,
  available,
}) => {
  const statusColor = available ? (active > 0 ? 'green' : 'gray') : 'red';
  const statusIcon = available ? (active > 0 ? '●' : '○') : '✗';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusColor}
      paddingX={1}
      width={14}
    >
      <Text bold>{laneId}</Text>
      <Text color={statusColor}>
        {statusIcon} {active}/{active + queued}
      </Text>
    </Box>
  );
};

// ============================================================================
// Goal Summary Component
// ============================================================================

const GoalSummary: React.FC = () => {
  const { state, inspect } = useDebugContext();
  const { snapshot, schedulerState } = state;

  if (!snapshot) {
    return (
      <Box padding={1}>
        <Text dimColor>Loading goals...</Text>
      </Box>
    );
  }

  const activeGoals = schedulerState?.goalStates || [];

  if (activeGoals.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No active goals</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {activeGoals.slice(0, 5).map((gs) => {
        const goal = state.goals.find(g => g.id === gs.goalId);
        const progress = gs.totalWorkItems > 0
          ? Math.round((gs.completedWorkItems / gs.totalWorkItems) * 100)
          : 0;
        const progressBar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));

        return (
          <Box key={gs.goalId} paddingX={1}>
            <Text color="cyan">{gs.goalId.slice(0, 8)}</Text>
            <Text dimColor>  </Text>
            <Text>{goal?.title?.slice(0, 30) || 'Unknown'}</Text>
            <Text dimColor>  </Text>
            <Text color={progress === 100 ? 'green' : 'yellow'}>{progressBar}</Text>
            <Text dimColor> {progress}%</Text>
            <Text dimColor>  [{gs.completedWorkItems}/{gs.totalWorkItems}]</Text>
          </Box>
        );
      })}
    </Box>
  );
};

// ============================================================================
// Recent Events Component
// ============================================================================

const RecentEvents: React.FC = () => {
  const { state } = useDebugContext();
  const events = state.events.slice(0, 8);

  if (events.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No recent events</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {events.map((evt) => {
        const time = new Date(evt.timestamp).toLocaleTimeString();
        const typeColor = evt.type.includes('error') || evt.type.includes('failed')
          ? 'red'
          : evt.type.includes('completed')
            ? 'green'
            : evt.type.includes('started')
              ? 'yellow'
              : 'gray';

        // Extract key info from event data
        let info = '';
        if (evt.data.goalId) info = String(evt.data.goalId).slice(0, 8);
        else if (evt.data.workItemId) info = String(evt.data.workItemId).slice(0, 8);
        else if (evt.data.id) info = String(evt.data.id).slice(0, 8);

        return (
          <Box key={evt.id} paddingX={1}>
            <Text dimColor>{time}</Text>
            <Text dimColor>  </Text>
            <Text color={typeColor}>{evt.type.padEnd(24)}</Text>
            <Text dimColor>{info}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

// ============================================================================
// Overview View
// ============================================================================

export const OverviewView: React.FC = () => {
  const { state } = useDebugContext();
  const { snapshot, schedulerState } = state;

  // Get lane data
  const lanes = state.lanes.length > 0
    ? state.lanes
    : [
        { laneId: 'main', status: { activeCount: 0, queuedCount: 0, isAvailable: false } },
        { laneId: 'subagent', status: { activeCount: 0, queuedCount: 0, isAvailable: false } },
        { laneId: 'cron', status: { activeCount: 0, queuedCount: 0, isAvailable: false } },
        { laneId: 'session', status: { activeCount: 0, queuedCount: 0, isAvailable: false } },
      ];

  return (
    <Box flexDirection="column" padding={1}>
      {/* Lanes Section */}
      <Box marginBottom={1}>
        <Text bold color="cyan">LANES</Text>
      </Box>
      <Box marginBottom={1}>
        {lanes.map((lane) => (
          <Box key={lane.laneId} marginRight={1}>
            <LaneCard
              laneId={lane.laneId}
              active={lane.status.activeCount}
              queued={lane.status.queuedCount}
              available={lane.status.isAvailable}
            />
          </Box>
        ))}
      </Box>

      {/* Stats Section */}
      <Box marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Box marginRight={3}>
          <Text dimColor>Goals: </Text>
          <Text>{snapshot?.goals.total || 0}</Text>
        </Box>
        <Box marginRight={3}>
          <Text dimColor>WorkItems: </Text>
          <Text>{snapshot?.workItems.total || 0}</Text>
        </Box>
        <Box marginRight={3}>
          <Text dimColor>Completed: </Text>
          <Text color="green">{schedulerState?.metrics.goalsCompleted || 0}</Text>
        </Box>
        <Box marginRight={3}>
          <Text dimColor>Failed: </Text>
          <Text color="red">{schedulerState?.metrics.goalsFailed || 0}</Text>
        </Box>
        <Box>
          <Text dimColor>Tokens: </Text>
          <Text>{(schedulerState?.metrics.totalTokensUsed || 0).toLocaleString()}</Text>
        </Box>
      </Box>

      {/* Active Goals Section */}
      <Box marginBottom={1}>
        <Text bold color="cyan">ACTIVE GOALS ({schedulerState?.activeGoals.length || 0})</Text>
      </Box>
      <Box marginBottom={1} borderStyle="single" borderColor="gray" flexDirection="column">
        <GoalSummary />
      </Box>

      {/* Recent Events Section */}
      <Box marginBottom={1}>
        <Text bold color="cyan">RECENT EVENTS</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" flexDirection="column">
        <RecentEvents />
      </Box>
    </Box>
  );
};
