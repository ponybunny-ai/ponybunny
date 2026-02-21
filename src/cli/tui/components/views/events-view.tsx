/**
 * EventsView - Real-time event log view
 */

import * as React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { EventItem } from '../widgets/event-item.js';

type EventFilter = 'all' | 'goal' | 'workitem' | 'escalation' | 'system';
const FILTER_OPTIONS: EventFilter[] = ['all', 'goal', 'workitem', 'escalation', 'system'];

export const EventsView: React.FC = () => {
  const { state, clearEvents } = useAppContext();
  const { events } = state;

  const [filter, setFilter] = useState<EventFilter>('all');
  const [compact, setCompact] = useState(true);

  // Filter events
  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => e.event.startsWith(filter));

  // Handle keyboard input
  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow) {
      const direction = key.rightArrow ? 1 : -1;
      setFilter(current => {
        const currentIndex = FILTER_OPTIONS.indexOf(current);
        const nextIndex = (currentIndex + direction + FILTER_OPTIONS.length) % FILTER_OPTIONS.length;
        return FILTER_OPTIONS[nextIndex];
      });
      return;
    }

    // Filter shortcuts
    if (input === 'a') setFilter('all');
    if (input === 'g') setFilter('goal');
    if (input === 'w') setFilter('workitem');
    if (input === 'e') setFilter('escalation');
    if (input === 's') setFilter('system');

    // Toggle compact mode
    if (input === 'v') setCompact(c => !c);

    // Clear events
    if (key.ctrl && input === 'l') {
      clearEvents();
    }
  });

  const displayEvents = filteredEvents.slice(-20).reverse();

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Filter bar */}
      <Box marginBottom={1}>
        <Text dimColor>Filter: </Text>
        {FILTER_OPTIONS.map((f, i) => (
          <React.Fragment key={f}>
            {i > 0 && <Text dimColor> │ </Text>}
            <Text
              color={filter === f ? 'cyan' : undefined}
              bold={filter === f}
              dimColor={filter !== f}
            >
              {f}
            </Text>
          </React.Fragment>
        ))}
        <Box flexGrow={1} />
        <Text dimColor>←/→: filter │ v: toggle view │ Ctrl+L: clear</Text>
      </Box>

      {/* Events list */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexGrow={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">Events ({filteredEvents.length})</Text>
          <Text dimColor>{compact ? 'compact' : 'detailed'} view</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {displayEvents.length === 0 ? (
            <Text dimColor>No events yet. Events will appear here as work progresses.</Text>
          ) : (
            displayEvents.map(event => (
              <EventItem key={event.id} event={event} compact={compact} />
            ))
          )}
        </Box>

        {filteredEvents.length > 20 && (
          <Box marginTop={1}>
            <Text dimColor>Showing latest 20 of {filteredEvents.length} events</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
