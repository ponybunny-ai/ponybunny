/**
 * Events View - Real-time event stream
 */

import * as React from 'react';
import { Box, Text, useInput } from 'ink';
import { useDebugContext } from '../context.js';
import type { DebugEvent } from '../types.js';

// ============================================================================
// Event Type Colors
// ============================================================================

const getEventColor = (eventType: string): string => {
  if (eventType.includes('error') || eventType.includes('failed')) return 'red';
  if (eventType.includes('completed') || eventType.includes('success')) return 'green';
  if (eventType.includes('started') || eventType.includes('running')) return 'yellow';
  if (eventType.includes('queued') || eventType.includes('ready')) return 'cyan';
  if (eventType.includes('cancelled') || eventType.includes('blocked')) return 'magenta';
  return 'gray';
};

// ============================================================================
// Event Row Component
// ============================================================================

interface EventRowProps {
  event: DebugEvent;
  isSelected: boolean;
  showDetails: boolean;
}

const EventRow: React.FC<EventRowProps> = ({ event, isSelected, showDetails }) => {
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);

  const color = getEventColor(event.type);

  // Extract key info from event data
  const extractInfo = (): string => {
    const parts: string[] = [];
    if (event.data.goalId) parts.push(`goal:${String(event.data.goalId).slice(0, 6)}`);
    if (event.data.workItemId) parts.push(`wi:${String(event.data.workItemId).slice(0, 6)}`);
    if (event.data.runId) parts.push(`run:${String(event.data.runId).slice(0, 6)}`);
    if (event.data.laneId) parts.push(`lane:${event.data.laneId}`);
    if (event.data.status) parts.push(`status:${event.data.status}`);
    if (event.data.tokens) parts.push(`tokens:${event.data.tokens}`);
    if (event.data.error) parts.push(`error:${String(event.data.error).slice(0, 20)}`);
    return parts.join('  ');
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{time}</Text>
        <Text dimColor>  </Text>
        <Text color={color as any} bold={isSelected} inverse={isSelected}>
          {event.type.padEnd(28)}
        </Text>
        <Text dimColor>{extractInfo()}</Text>
      </Box>
      {showDetails && isSelected && (
        <Box paddingLeft={4} marginBottom={1}>
          <Text dimColor>
            {JSON.stringify(event.data, null, 2).split('\n').slice(0, 5).join('\n')}
          </Text>
        </Box>
      )}
    </Box>
  );
};

// ============================================================================
// Filter Bar Component
// ============================================================================

interface FilterBarProps {
  filter: string;
  isPaused: boolean;
  eventCount: number;
  onTogglePause: () => void;
  onClear: () => void;
}

const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  isPaused,
  eventCount,
  onTogglePause,
  onClear,
}) => {
  return (
    <Box marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Box marginRight={3}>
        <Text dimColor>Filter: </Text>
        <Text>{filter || 'all'}</Text>
      </Box>
      <Box marginRight={3}>
        <Text dimColor>Pause: </Text>
        <Text color={isPaused ? 'yellow' : 'green'}>{isPaused ? 'ON' : 'OFF'}</Text>
      </Box>
      <Box marginRight={3}>
        <Text dimColor>Events: </Text>
        <Text>{eventCount}</Text>
      </Box>
      <Box>
        <Text dimColor>p: pause | c: clear | f: filter</Text>
      </Box>
    </Box>
  );
};

// ============================================================================
// Events View
// ============================================================================

export const EventsView: React.FC = () => {
  const { state, toggleEventsPaused, clearEvents, setEventsFilter, inspect } = useDebugContext();
  const { events, eventsPaused, eventsFilter } = state;
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [showDetails, setShowDetails] = React.useState(false);

  // Filter events
  const filteredEvents = eventsFilter
    ? events.filter(e => e.type.includes(eventsFilter))
    : events;

  // Handle keyboard input
  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(filteredEvents.length - 1, selectedIndex + 1));
    } else if (input === 'p') {
      toggleEventsPaused();
    } else if (input === 'c') {
      clearEvents();
      setSelectedIndex(0);
    } else if (input === 'd') {
      setShowDetails(!showDetails);
    } else if (key.return) {
      const event = filteredEvents[selectedIndex];
      if (event) {
        // Try to inspect related entity
        if (event.data.goalId) {
          inspect({ type: 'goal', id: String(event.data.goalId) });
        } else if (event.data.workItemId) {
          inspect({ type: 'workitem', id: String(event.data.workItemId) });
        } else if (event.data.runId) {
          inspect({ type: 'run', id: String(event.data.runId) });
        }
      }
    }
  });

  // Visible events (show last 20)
  const visibleEvents = filteredEvents.slice(0, 20);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">EVENT STREAM</Text>
        <Text dimColor>  (↑↓: navigate, Enter: inspect, d: details, p: pause, c: clear)</Text>
      </Box>

      <FilterBar
        filter={eventsFilter}
        isPaused={eventsPaused}
        eventCount={filteredEvents.length}
        onTogglePause={toggleEventsPaused}
        onClear={clearEvents}
      />

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        {visibleEvents.length === 0 ? (
          <Box padding={1}>
            <Text dimColor>No events yet. Events will appear here as they occur.</Text>
          </Box>
        ) : (
          visibleEvents.map((event, idx) => (
            <EventRow
              key={event.id}
              event={event}
              isSelected={idx === selectedIndex}
              showDetails={showDetails}
            />
          ))
        )}
      </Box>

      {/* Event type legend */}
      <Box marginTop={1} paddingX={1}>
        <Text dimColor>Legend: </Text>
        <Text color="green">● completed </Text>
        <Text color="yellow">● started </Text>
        <Text color="cyan">● queued </Text>
        <Text color="red">● error </Text>
        <Text color="magenta">● blocked </Text>
      </Box>

      {filteredEvents.length > 20 && (
        <Box marginTop={1}>
          <Text dimColor>
            Showing 20 of {filteredEvents.length} events (scroll to see more)
          </Text>
        </Box>
      )}
    </Box>
  );
};
