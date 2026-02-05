/**
 * Debug TUI App - Root component for the debug/observability TUI
 */

import * as React from 'react';
import { useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { DebugProvider, useDebugContext } from './context.js';
import { OverviewView } from './views/overview-view.js';
import { TasksView } from './views/tasks-view.js';
import { LanesView } from './views/lanes-view.js';
import { EventsView } from './views/events-view.js';
import { InspectView } from './views/inspect-view.js';
import type { DebugView } from './types.js';

// ============================================================================
// Tab Bar Component
// ============================================================================

const VIEWS: { id: DebugView; label: string; key: string }[] = [
  { id: 'overview', label: 'Overview', key: '1' },
  { id: 'tasks', label: 'Tasks', key: '2' },
  { id: 'lanes', label: 'Lanes', key: '3' },
  { id: 'events', label: 'Events', key: '4' },
  { id: 'inspect', label: 'Inspect', key: '5' },
];

const TabBar: React.FC = () => {
  const { state, setView } = useDebugContext();

  return (
    <Box>
      {VIEWS.map((view, idx) => {
        const isActive = state.currentView === view.id;
        return (
          <Box key={view.id} marginRight={1}>
            <Text
              color={isActive ? 'cyan' : 'gray'}
              bold={isActive}
              inverse={isActive}
            >
              {` ${view.key}:${view.label} `}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

// ============================================================================
// Status Bar Component
// ============================================================================

const StatusBar: React.FC = () => {
  const { state } = useDebugContext();

  const statusColor = {
    connecting: 'yellow',
    connected: 'green',
    disconnected: 'red',
    error: 'red',
  }[state.connectionStatus] as 'yellow' | 'green' | 'red';

  const schedulerStatus = state.schedulerState?.status || 'unknown';
  const schedulerColor = schedulerStatus === 'running' ? 'green' : schedulerStatus === 'paused' ? 'yellow' : 'gray';

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        <Text bold color="cyan">PonyBunny Debug</Text>
        <Text dimColor> | </Text>
        <Text color={statusColor}>{state.connectionStatus}</Text>
        {state.isRefreshing && (
          <>
            <Text dimColor> | </Text>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
          </>
        )}
      </Box>
      <Box>
        <Text dimColor>Scheduler: </Text>
        <Text color={schedulerColor}>{schedulerStatus}</Text>
        <Text dimColor> | </Text>
        <Text dimColor>Sessions: </Text>
        <Text>{state.snapshot?.gateway.connections.authenticated || 0}</Text>
        <Text dimColor> | </Text>
        <Text dimColor>Events: </Text>
        <Text>{state.events.length}</Text>
        {state.eventsPaused && <Text color="yellow"> (paused)</Text>}
      </Box>
    </Box>
  );
};

// ============================================================================
// Help Bar Component
// ============================================================================

const HelpBar: React.FC = () => {
  return (
    <Box paddingX={1}>
      <Text dimColor>
        1-5: Switch views | Tab: Next view | r: Refresh | p: Pause events | q/Esc: Quit
      </Text>
    </Box>
  );
};

// ============================================================================
// Main Content Component
// ============================================================================

const DebugContent: React.FC = () => {
  const { exit } = useApp();
  const { state, setView, refresh, subscribeToDebugEvents } = useDebugContext();

  // Initial data load and event subscription
  useEffect(() => {
    if (state.connectionStatus === 'connected') {
      refresh();
      subscribeToDebugEvents();
    }
  }, [state.connectionStatus]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (state.connectionStatus !== 'connected') return;

    const interval = setInterval(() => {
      refresh();
    }, 5000);

    return () => clearInterval(interval);
  }, [state.connectionStatus, refresh]);

  // Keyboard shortcuts
  useInput((input, key) => {
    // Quit
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    // Refresh
    if (input === 'r') {
      refresh();
      return;
    }

    // View switching with number keys
    const viewIndex = parseInt(input, 10) - 1;
    if (viewIndex >= 0 && viewIndex < VIEWS.length) {
      setView(VIEWS[viewIndex].id);
      return;
    }

    // Tab to cycle views
    if (key.tab) {
      const currentIndex = VIEWS.findIndex(v => v.id === state.currentView);
      const nextIndex = (currentIndex + 1) % VIEWS.length;
      setView(VIEWS[nextIndex].id);
      return;
    }
  });

  // Render current view
  const renderView = () => {
    switch (state.currentView) {
      case 'overview':
        return <OverviewView />;
      case 'tasks':
        return <TasksView />;
      case 'lanes':
        return <LanesView />;
      case 'events':
        return <EventsView />;
      case 'inspect':
        return <InspectView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Status Bar */}
      <Box borderStyle="round" borderColor="cyan">
        <StatusBar />
      </Box>

      {/* Tab Bar */}
      <Box marginY={0}>
        <TabBar />
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" flexGrow={1}>
        {state.connectionStatus === 'connecting' ? (
          <Box padding={2}>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Connecting to gateway...</Text>
          </Box>
        ) : state.connectionStatus === 'error' || state.connectionStatus === 'disconnected' ? (
          <Box padding={2} flexDirection="column">
            <Text color="red">Connection failed</Text>
            {state.errorMessage && <Text dimColor>{state.errorMessage}</Text>}
            <Text dimColor>Press 'r' to retry or 'q' to quit</Text>
          </Box>
        ) : (
          renderView()
        )}
      </Box>

      {/* Help Bar */}
      <Box borderStyle="single" borderColor="gray">
        <HelpBar />
      </Box>
    </Box>
  );
};

// ============================================================================
// App Component
// ============================================================================

export interface DebugAppProps {
  url?: string;
  token?: string;
}

export const DebugApp: React.FC<DebugAppProps> = ({ url, token }) => {
  return (
    <DebugProvider url={url} token={token}>
      <DebugContent />
    </DebugProvider>
  );
};
