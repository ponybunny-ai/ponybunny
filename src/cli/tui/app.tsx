/**
 * App - Root TUI component
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useApp, useInput } from 'ink';
import { GatewayProvider } from './context/gateway-context.js';
import { AppProvider, useAppContext } from './context/app-context.js';
import { useGatewayContext } from './context/gateway-context.js';
import { MainLayout, SimpleLayout } from './components/layout/index.js';
import { DashboardView, GoalsView, EventsView, HelpView, SimpleView } from './components/views/index.js';
import { GoalCreateModal, EscalationModal, ConfirmModal } from './components/modals/index.js';
import { executeCommand, handleNaturalInput, isCommand, type CommandContext } from './commands/index.js';
import type { GatewayEvent as ClientGatewayEvent } from '../gateway/index.js';

interface AppContentProps {
  onExit: () => void;
  onEvent?: (event: ClientGatewayEvent) => void;
}

const AppContent: React.FC<AppContentProps> = ({ onExit }) => {
  const app = useAppContext();
  const gateway = useGatewayContext();
  const { state, setView, addEvent } = app;

  // Input focus state - default to focused for better UX
  const [inputFocused, setInputFocused] = useState(true);

  // Store refs to avoid recreating callbacks
  const appRef = useRef(app);
  const gatewayRef = useRef(gateway);
  appRef.current = app;
  gatewayRef.current = gateway;

  // Create command context using refs
  const commandContext = useMemo<CommandContext>(() => ({
    get app() { return appRef.current; },
    get gateway() { return gatewayRef.current; },
    exit: onExit,
  }), [onExit]);

  // Handle keyboard shortcuts
  useInput((input, key) => {
    // Don't handle shortcuts when modal is open
    if (state.activeModal) {
      return;
    }

    // Escape to unfocus input
    if (key.escape) {
      if (inputFocused) {
        setInputFocused(false);
      }
      return;
    }

    // When input is focused, only handle escape (above) and let TextInput handle the rest
    if (inputFocused) {
      return;
    }

    // Focus input with / or i
    if (input === '/' || input === 'i') {
      setInputFocused(true);
      return;
    }

    // Expert mode only shortcuts
    if (state.displayMode === 'expert') {
      // Tab to cycle views
      if (key.tab) {
        const views = ['dashboard', 'goals', 'events', 'help'] as const;
        const currentIndex = views.indexOf(state.currentView);
        const nextIndex = (currentIndex + 1) % views.length;
        setView(views[nextIndex]);
        return;
      }

      // Number keys for direct view navigation
      if (input === '1') {
        setView('dashboard');
        return;
      }
      if (input === '2') {
        setView('goals');
        return;
      }
      if (input === '3') {
        setView('events');
        return;
      }
      if (input === '4') {
        setView('help');
        return;
      }

      // Ctrl+N for new goal
      if (key.ctrl && input === 'n') {
        app.openModal('goal-create');
        return;
      }
    }

    // Ctrl+E for escalations (both modes)
    if (key.ctrl && input === 'e') {
      if (state.escalations.length > 0) {
        app.openModal('escalation', { escalationId: state.escalations[0].id });
      }
      return;
    }
  });

  // Handle input submission
  const handleInputSubmit = useCallback(async (input: string) => {
    if (!input.trim()) {
      return;
    }

    app.addToInputHistory(input);

    if (isCommand(input)) {
      const result = await executeCommand(input, commandContext);
      if (result.error) {
        addEvent('command.error', { command: input, error: result.error });
      } else if (result.message) {
        addEvent('command.success', { command: input, message: result.message });
      }
    } else {
      // Natural language input - treat as goal creation
      await handleNaturalInput(input, commandContext);
    }

    // Unfocus input after submission
    setInputFocused(false);
  }, [commandContext]);

  // Track if initial data has been loaded
  const initialLoadDone = useRef(false);

  // Load initial data when connected
  useEffect(() => {
    const { connectionStatus, client } = gatewayRef.current;
    if (connectionStatus === 'connected' && client && !initialLoadDone.current) {
      initialLoadDone.current = true;

      // Load goals
      client.listGoals().then(result => {
        appRef.current.setGoals(result.goals);
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load goals: ${err.message}` });
      });

      // Load escalations
      client.listEscalations().then(result => {
        appRef.current.setEscalations(result.escalations as Parameters<typeof appRef.current.setEscalations>[0]);
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load escalations: ${err.message}` });
      });
    }
  }, [gateway.connectionStatus]);

  // Render current view (expert mode)
  const renderExpertView = () => {
    switch (state.currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'goals':
        return <GoalsView />;
      case 'events':
        return <EventsView />;
      case 'help':
        return <HelpView />;
      default:
        return <DashboardView />;
    }
  };

  // Render active modal
  const renderModal = () => {
    switch (state.activeModal) {
      case 'goal-create':
        return <GoalCreateModal />;
      case 'escalation':
        const escalationData = state.modalData as { escalationId: string } | undefined;
        if (escalationData?.escalationId) {
          return <EscalationModal escalationId={escalationData.escalationId} />;
        }
        return null;
      case 'confirm':
        return <ConfirmModal />;
      default:
        return null;
    }
  };

  // Render based on display mode
  const renderContent = () => {
    if (state.displayMode === 'simple') {
      return (
        <SimpleLayout onInputSubmit={handleInputSubmit} inputFocus={inputFocused}>
          <SimpleView />
        </SimpleLayout>
      );
    }

    return (
      <MainLayout onInputSubmit={handleInputSubmit} inputFocus={inputFocused}>
        {renderExpertView()}
      </MainLayout>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {renderContent()}

      {/* Modal overlay */}
      {state.activeModal && (
        <Box
          position="absolute"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          width="100%"
          height="100%"
        >
          {renderModal()}
        </Box>
      )}
    </Box>
  );
};

/**
 * Inner component that has access to AppContext for event handling
 */
const AppWithEventHandler: React.FC<{ url?: string; token?: string; onExit: () => void }> = ({
  url,
  token,
  onExit,
}) => {
  const app = useAppContext();
  const { addEvent, addGoal, updateGoal, addEscalation } = app;

  // Store handlers in ref to avoid recreating GatewayProvider
  const handlersRef = useRef({ addEvent, addGoal, updateGoal, addEscalation, app });
  handlersRef.current = { addEvent, addGoal, updateGoal, addEscalation, app };

  const handleConnected = useCallback(() => {
    // Connection established
  }, []);

  const handleDisconnected = useCallback((_reason: string) => {
    // Connection lost
  }, []);

  const handleEvent = useCallback((event: ClientGatewayEvent) => {
    const { addEvent, addGoal, updateGoal, addEscalation, app } = handlersRef.current;
    const data = event.data as Record<string, unknown> | undefined;
    addEvent(event.event, data);

    // Helper to find and update simple message by goalId
    const updateSimpleMessageByGoalId = (goalId: string, updates: Parameters<typeof app.updateSimpleMessage>[1]) => {
      const message = app.state.simpleMessages.find(m => m.goalId === goalId);
      if (message) {
        app.updateSimpleMessage(message.id, updates);
      }
    };

    // Update state based on event type
    switch (event.event) {
      case 'goal.created':
      case 'goal.started':
        if (data?.goal) {
          addGoal(data.goal as Parameters<typeof addGoal>[0]);
          const goal = data.goal as { id: string };
          updateSimpleMessageByGoalId(goal.id, {
            status: 'processing',
            statusText: 'Executing...',
          });
        }
        break;

      case 'goal.updated':
        if (data?.goal) {
          updateGoal(data.goal as Parameters<typeof updateGoal>[0]);
        }
        break;

      case 'goal.completed':
        if (data?.goal) {
          updateGoal(data.goal as Parameters<typeof updateGoal>[0]);
          const goal = data.goal as { id: string };
          updateSimpleMessageByGoalId(goal.id, {
            status: 'completed',
          });
        }
        break;

      case 'goal.failed':
        if (data?.goal) {
          updateGoal(data.goal as Parameters<typeof updateGoal>[0]);
          const goal = data.goal as { id: string; error?: string };
          updateSimpleMessageByGoalId(goal.id, {
            status: 'failed',
            error: goal.error || 'Execution failed',
          });
        }
        break;

      case 'workitem.created':
      case 'workitem.completed':
      case 'workitem.failed':
        if (data?.workItem) {
          app.updateWorkItem(data.workItem as Parameters<typeof app.updateWorkItem>[0]);
        }
        break;

      case 'workitem.started':
        if (data?.workItem) {
          app.updateWorkItem(data.workItem as Parameters<typeof app.updateWorkItem>[0]);
          const workItem = data.workItem as { goal_id: string; title: string };
          updateSimpleMessageByGoalId(workItem.goal_id, {
            status: 'processing',
            statusText: `Processing: ${workItem.title}...`,
          });
        }
        break;

      case 'escalation.created':
        if (data?.escalation) {
          addEscalation(data.escalation as Parameters<typeof addEscalation>[0]);
          // In simple mode, show escalation warning for the related goal
          const escalation = data.escalation as { goal_id?: string };
          if (escalation.goal_id) {
            updateSimpleMessageByGoalId(escalation.goal_id, {
              status: 'processing',
              statusText: '⚠ Needs confirmation',
            });
          }
        }
        break;

      case 'escalation.resolved':
        if (data?.escalationId) {
          app.removeEscalation(data.escalationId as string);
        }
        break;
    }
  }, []);

  const handleError = useCallback((_error: Error) => {
    // Connection error
  }, []);

  return (
    <GatewayProvider
      url={url}
      token={token}
      onConnected={handleConnected}
      onDisconnected={handleDisconnected}
      onEvent={handleEvent}
      onError={handleError}
    >
      <AppContent onExit={onExit} />
    </GatewayProvider>
  );
};

export interface AppProps {
  url?: string;
  token?: string;
}

export const App: React.FC<AppProps> = ({ url, token }) => {
  const { exit } = useApp();

  return (
    <AppProvider initialUrl={url}>
      <AppWithEventHandler url={url} token={token} onExit={exit} />
    </AppProvider>
  );
};

export default App;
