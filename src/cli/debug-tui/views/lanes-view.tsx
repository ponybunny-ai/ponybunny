/**
 * Lanes View - Agent Lane status with queued/active items
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useDebugContext } from '../context.js';
import type { DebugLaneInfo } from '../types.js';

// ============================================================================
// Lane Item Component
// ============================================================================

interface LaneItemProps {
  item: {
    workItemId: string;
    goalId: string;
    title: string;
    startedAt?: number;
  };
  isActive: boolean;
  isSelected: boolean;
}

const LaneItem: React.FC<LaneItemProps> = ({ item, isActive, isSelected }) => {
  const duration = item.startedAt
    ? `${((Date.now() - item.startedAt) / 1000).toFixed(0)}s`
    : '';

  return (
    <Box paddingLeft={2}>
      <Text color={isActive ? 'yellow' : 'gray'}>{isActive ? '●' : '○'}</Text>
      <Text bold={isSelected} inverse={isSelected}> {item.workItemId.slice(0, 8)}</Text>
      <Text dimColor>  </Text>
      <Text>"{item.title?.slice(0, 30) || 'Untitled'}"</Text>
      <Text dimColor>  goal:{item.goalId.slice(0, 6)}</Text>
      {isActive && duration && <Text dimColor>  {duration}</Text>}
      {!isActive && <Text dimColor>  queued</Text>}
    </Box>
  );
};

// ============================================================================
// Lane Section Component
// ============================================================================

interface LaneSectionProps {
  lane: DebugLaneInfo;
  isSelected: boolean;
}

const LaneSection: React.FC<LaneSectionProps> = ({ lane, isSelected }) => {
  const { status, activeItems, queuedItems } = lane;
  const statusColor = status.isAvailable
    ? status.activeCount > 0
      ? 'green'
      : 'gray'
    : 'red';

  const totalItems = activeItems.length + queuedItems.length;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={isSelected ? 'cyan' : 'white'} inverse={isSelected}>
          {` ${lane.laneId.toUpperCase()} `}
        </Text>
        <Text dimColor> ({status.activeCount}/{status.activeCount + status.queuedCount} active)</Text>
        <Text color={statusColor}> {status.isAvailable ? '●' : '○'}</Text>
      </Box>

      <Box flexDirection="column" paddingLeft={1} borderStyle="single" borderColor="gray">
        {totalItems === 0 ? (
          <Box padding={1}>
            <Text dimColor>(empty)</Text>
          </Box>
        ) : (
          <>
            {activeItems.map((item) => (
              <LaneItem
                key={item.workItemId}
                item={item}
                isActive={true}
                isSelected={false}
              />
            ))}
            {queuedItems.map((item) => (
              <LaneItem
                key={item.workItemId}
                item={item}
                isActive={false}
                isSelected={false}
              />
            ))}
          </>
        )}
      </Box>
    </Box>
  );
};

// ============================================================================
// Lanes View
// ============================================================================

export const LanesView: React.FC = () => {
  const { state, inspect } = useDebugContext();
  const { lanes, schedulerState } = state;
  const [selectedLaneIndex, setSelectedLaneIndex] = React.useState(0);

  // Default lanes if none loaded
  const displayLanes: DebugLaneInfo[] = lanes.length > 0
    ? lanes
    : [
        { laneId: 'main', status: { laneId: 'main', activeCount: 0, queuedCount: 0, isAvailable: false }, activeItems: [], queuedItems: [] },
        { laneId: 'subagent', status: { laneId: 'subagent', activeCount: 0, queuedCount: 0, isAvailable: false }, activeItems: [], queuedItems: [] },
        { laneId: 'cron', status: { laneId: 'cron', activeCount: 0, queuedCount: 0, isAvailable: false }, activeItems: [], queuedItems: [] },
        { laneId: 'session', status: { laneId: 'session', activeCount: 0, queuedCount: 0, isAvailable: false }, activeItems: [], queuedItems: [] },
      ];

  // Handle keyboard input
  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedLaneIndex(Math.max(0, selectedLaneIndex - 1));
    } else if (key.downArrow) {
      setSelectedLaneIndex(Math.min(displayLanes.length - 1, selectedLaneIndex + 1));
    }
  });

  // Calculate totals
  const totalActive = displayLanes.reduce((sum, l) => sum + l.status.activeCount, 0);
  const totalQueued = displayLanes.reduce((sum, l) => sum + l.status.queuedCount, 0);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">EXECUTION LANES</Text>
        <Text dimColor>  (↑↓: navigate lanes)</Text>
      </Box>

      {/* Summary */}
      <Box marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Box marginRight={3}>
          <Text dimColor>Total Active: </Text>
          <Text color="yellow">{totalActive}</Text>
        </Box>
        <Box marginRight={3}>
          <Text dimColor>Total Queued: </Text>
          <Text>{totalQueued}</Text>
        </Box>
        <Box marginRight={3}>
          <Text dimColor>Scheduler: </Text>
          <Text color={schedulerState?.status === 'running' ? 'green' : 'yellow'}>
            {schedulerState?.status || 'unknown'}
          </Text>
        </Box>
        {schedulerState?.lastTickAt && (
          <Box>
            <Text dimColor>Last Tick: </Text>
            <Text>{new Date(schedulerState.lastTickAt).toLocaleTimeString()}</Text>
          </Box>
        )}
      </Box>

      {/* Lane sections */}
      <Box flexDirection="column">
        {displayLanes.map((lane, idx) => (
          <LaneSection
            key={lane.laneId}
            lane={lane}
            isSelected={idx === selectedLaneIndex}
          />
        ))}
      </Box>

      {/* Lane capacity info */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>Lane Capacity: </Text>
        {displayLanes.map((lane, idx) => (
          <Box key={lane.laneId} marginRight={2}>
            <Text dimColor>{lane.laneId}: </Text>
            <Text color={lane.status.isAvailable ? 'green' : 'red'}>
              {lane.status.activeCount}/{lane.status.activeCount + lane.status.queuedCount}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
