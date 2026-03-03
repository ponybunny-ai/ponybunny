/**
 * EventsView - Real-time event log view
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppContext } from '../../context/app-context.js';
import { EventItem } from '../widgets/event-item.js';

type EventFilter = 'all' | 'goal' | 'workitem' | 'escalation' | 'system' | 'conversation';
const FILTER_OPTIONS: EventFilter[] = ['all', 'goal', 'workitem', 'escalation', 'system', 'conversation'];

export const EventsView: React.FC = () => {
  const { state, clearEvents, setEventsViewState } = useAppContext();
  const { events } = state;

  const [filter, setFilter] = useState<EventFilter>(state.eventsFilter);
  const [compact, setCompact] = useState(true);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState(state.eventsSearchQuery);

  React.useEffect(() => {
    setEventsViewState(filter, searchQuery);
  }, [filter, searchQuery, setEventsViewState]);

  React.useEffect(() => {
    if (!searchMode && state.eventsFilter !== filter) {
      setFilter(state.eventsFilter);
    }
    if (!searchMode && state.eventsSearchQuery !== searchQuery) {
      setSearchQuery(state.eventsSearchQuery);
    }
  }, [filter, searchMode, searchQuery, state.eventsFilter, state.eventsSearchQuery]);

  // Filter events
  const filteredEvents = useMemo(() => {
    const scoped = (() => {
      if (filter === 'all') return events;
      if (filter === 'conversation') return events.filter(e => e.event.startsWith('conversation.'));
      return events.filter(e => e.event.startsWith(filter));
    })();

    const q = searchQuery.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((e) => {
      const dataStr = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
      return `${e.event} ${dataStr}`.toLowerCase().includes(q);
    });
  }, [events, filter, searchQuery]);

  // Handle keyboard input
  useInput((input, key) => {
    if (state.activeModal) {
      return;
    }

    if (searchMode) {
      if (key.escape || key.return) {
        setSearchMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery((prev) => prev.slice(0, -1));
        return;
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setSearchQuery((prev) => prev + input);
      }
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      return;
    }

    if (input === 'q') {
      setSearchQuery('');
      return;
    }

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
    if (input === 'c') setFilter('conversation');

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
        <Text dimColor>←/→: filter │ /: search │ q: clear-search │ v: toggle view │ Ctrl+L: clear</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Search: {searchMode ? 'editing' : 'idle'}{searchQuery ? ` · "${searchQuery}"` : ' · (empty)'}</Text>
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
              <EventItem key={event.id} event={event} compact={compact} searchQuery={searchQuery} />
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
