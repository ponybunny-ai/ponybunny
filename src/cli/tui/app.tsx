/**
 * App - Root TUI component
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useApp, useInput } from 'ink';
import { GatewayProvider } from './context/gateway-context.js';
import { AppProvider, useAppContext } from './context/app-context.js';
import { useGatewayContext } from './context/gateway-context.js';
import { MainLayout } from './components/layout/index.js';
import { DashboardView, TasksView, GoalsView, EventsView, HelpView } from './components/views/index.js';
import { GoalCreateModal, EscalationModal, ConfirmModal } from './components/modals/index.js';
import { executeCommand, handleNaturalInput, isCommand, type CommandContext } from './commands/index.js';
import type { GatewayEvent as ClientGatewayEvent, TuiGatewayClient } from '../gateway/index.js';
import { useTerminalSize } from './hooks/use-terminal-size.js';

interface AppContentProps {
  onExit: () => void;
  onEvent?: (event: ClientGatewayEvent) => void;
}

function extractActionHints(text: string): Array<{ label: string; kind: 'file' | 'url' | 'command'; target: string }> {
  const result: Array<{ label: string; kind: 'file' | 'url' | 'command'; target: string }> = [];
  const seen = new Set<string>();

  const urls = text.match(/https?:\/\/[^\s)]+/g) || [];
  for (const url of urls.slice(0, 6)) {
    if (seen.has(url)) continue;
    seen.add(url);
    result.push({ label: `Open URL: ${url}`, kind: 'url', target: url });
  }

  const files = text.match(/(?:\.|\/|~\/)[\w./-]+\.[\w]+/g) || [];
  for (const filePath of files.slice(0, 6)) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    result.push({ label: `Open file: ${filePath}`, kind: 'file', target: filePath });
  }

  return result;
}

function firstMeaningfulLine(log?: string): string | undefined {
  if (!log) return undefined;
  return log
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('[POLICY_AUDIT]') && !line.startsWith('[ROUTE_CONTEXT]'));
}

function deriveMessageStatusFromGoalStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed';
  if (status === 'blocked' || status === 'cancelled') return 'failed';
  if (status === 'active') return 'processing';
  return 'pending';
}

const AppContent: React.FC<AppContentProps> = ({ onExit }) => {
  const app = useAppContext();
  const gateway = useGatewayContext();
  const { state, setView, addEvent, setInputValue } = app;

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
      if (input === '/') {
        setInputValue('/');
      }
      return;
    }

    // Tab to cycle views
    if (key.tab) {
      const views = ['dashboard', 'tasks', 'goals', 'events', 'help'] as const;
      const currentIndex = views.indexOf(state.currentView);
      const nextIndex = (currentIndex + 1) % views.length;
      setView(views[nextIndex]);
      return;
    }

    const viewByShortcut: Record<string, typeof state.currentView> = {
      '1': 'dashboard',
      '2': 'tasks',
      '3': 'goals',
      '4': 'events',
      '5': 'help',
    };
    if (viewByShortcut[input]) {
      setView(viewByShortcut[input]);
      return;
    }

    // Ctrl+N for new goal
    if (key.ctrl && input === 'n') {
      app.openModal('goal-create');
      return;
    }

    // Ctrl+E for escalations (both modes)
    if (key.ctrl && input === 'e') {
      if (state.escalations.length > 0) {
        app.openModal('escalation', { escalationId: state.escalations[0].id });
      }
      return;
    }

    if (key.ctrl && input === 'r') {
      void (async () => {
        const result = await executeCommand('/refresh', commandContext);
        if (result.error) {
          addEvent('command.error', { command: '/refresh', error: result.error });
        } else if (result.message) {
          addEvent('command.success', { command: '/refresh', message: result.message });
        }
      })();
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

        for (const goal of result.goals) {
          appRef.current.addSimpleMessage({
            id: `history-goal-${goal.id}`,
            input: goal.description || goal.title,
            status: deriveMessageStatusFromGoalStatus(goal.status),
            statusText: `Goal status: ${goal.status}`,
            goalId: goal.id,
            timeline: [
              {
                timestamp: goal.updated_at || goal.created_at,
                stage: 'History loaded',
                detail: `Persisted goal ${goal.id} loaded from storage.`,
              },
            ],
            timestamp: goal.created_at,
          });
        }
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load goals: ${err.message}` });
      });

      // Load escalations
      client.listEscalations().then(result => {
        appRef.current.setEscalations(result.escalations as Parameters<typeof appRef.current.setEscalations>[0]);
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load escalations: ${err.message}` });
      });

      // Load work items
      client.listWorkItems().then(result => {
        appRef.current.setWorkItems(result.workItems);
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load work items: ${err.message}` });
      });

      client.getSystemCapabilities().then(result => {
        appRef.current.setSchedulerCapabilities(result);
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load scheduler capabilities: ${err.message}` });
      });
    }
  }, [gateway.connectionStatus]);

  // Render current view
  const renderCurrentView = () => {
    switch (state.currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'tasks':
        return <TasksView />;
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
  const renderContent = () => (
    <MainLayout onInputSubmit={handleInputSubmit} inputFocus={inputFocused}>
      {renderCurrentView()}
    </MainLayout>
  );

  const { columns, rows } = useTerminalSize();
  const viewportRows = Math.max(1, rows - 1);

  return (
    <Box flexDirection="column" height={viewportRows} width={columns}>
      {renderContent()}

      {/* Modal overlay */}
      {state.activeModal && (
        <Box
          position="absolute"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
          width={columns}
          height={viewportRows}
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
  const { addEvent, addGoal, updateGoal, addEscalation, setSchedulerCapabilities } = app;
  const clientRef = useRef<TuiGatewayClient | null>(null);

  // Store handlers in ref to avoid recreating GatewayProvider
  const handlersRef = useRef({
    addEvent,
    addGoal,
    updateGoal,
    addEscalation,
    setSchedulerCapabilities,
    app,
  });
  handlersRef.current = {
    addEvent,
    addGoal,
    updateGoal,
    addEscalation,
    setSchedulerCapabilities,
    app,
  };

  const handleConnected = useCallback(() => {
    // Connection established
  }, []);

  const handleDisconnected = useCallback((_reason: string) => {
    // Connection lost
  }, []);

  const handleEvent = useCallback(async (event: ClientGatewayEvent) => {
    const { addEvent, addGoal, updateGoal, addEscalation, setSchedulerCapabilities, app } =
      handlersRef.current;
    const data = event.data as Record<string, unknown> | undefined;
    const client = clientRef.current;
    addEvent(event.event, data);

    // Helper to find and update message by goalId
    const updateSimpleMessageByGoalId = (goalId: string, updates: Parameters<typeof app.updateSimpleMessage>[1]) => {
      const message = app.state.simpleMessages.find(m => m.goalId === goalId);
      if (message) {
        app.updateSimpleMessage(message.id, updates);
      }
    };

    const appendTimelineByGoalId = (goalId: string, stage: string, detail?: string) => {
      const message = app.state.simpleMessages.find(m => m.goalId === goalId);
      if (!message) return;
      const timeline = [...(message.timeline || []), { timestamp: Date.now(), stage, detail }].slice(-40);
      app.updateSimpleMessage(message.id, { timeline });
    };

    const updateLatestProcessingMessage = (updates: Parameters<typeof app.updateSimpleMessage>[1]) => {
      const latest = [...app.state.simpleMessages]
        .sort((a, b) => b.timestamp - a.timestamp)
        .find((m) => m.status === 'processing' || m.status === 'pending');
      if (latest) {
        app.updateSimpleMessage(latest.id, updates);
      }
    };

    const appendTimelineLatest = (stage: string, detail?: string) => {
      const latest = [...app.state.simpleMessages]
        .sort((a, b) => b.timestamp - a.timestamp)
        .find((m) => m.status === 'processing' || m.status === 'pending');
      if (!latest) return;
      const timeline = [...(latest.timeline || []), { timestamp: Date.now(), stage, detail }].slice(-40);
      app.updateSimpleMessage(latest.id, { timeline });
    };

    const attachRunResultByGoalId = async (goalId: string, workItemId?: string, runId?: string) => {
      if (!client || !workItemId) return;
      try {
        const runsResp = await client.getWorkItemRuns(workItemId);
        const runs = (runsResp.runs as Array<Record<string, unknown>>) || [];
        const run = runId
          ? runs.find((r) => typeof r.id === 'string' && r.id === runId)
          : runs[runs.length - 1];
        const log = typeof run?.execution_log === 'string' ? run.execution_log : undefined;
        const summary = firstMeaningfulLine(log) || (typeof run?.error_message === 'string' ? run.error_message : undefined);

        const message = app.state.simpleMessages.find(m => m.goalId === goalId);
        if (!message) return;

        app.updateSimpleMessage(message.id, {
          workItemId,
          runId: typeof run?.id === 'string' ? run.id : undefined,
          resultSummary: summary,
          actions: log ? extractActionHints(log) : message.actions,
        });
      } catch {
      }
    };

    const upsertGoalById = async (goalId: string) => {
      if (!client) {
        return;
      }
      try {
        const goal = await client.getGoalStatus(goalId);
        if (app.state.goals.some(g => g.id === goal.id)) {
          updateGoal(goal);
        } else {
          addGoal(goal);
        }
      } catch (error) {
        app.addEvent('error', { message: `Failed to load goal ${goalId}: ${(error as Error).message}` });
      }
    };

    const upsertWorkItemById = async (workItemId: string) => {
      if (!client) {
        return null;
      }
      try {
        const workItem = await client.getWorkItem(workItemId);
        if (workItem) {
          app.updateWorkItem(workItem);
          return workItem;
        }
      } catch (error) {
        app.addEvent('error', { message: `Failed to load work item ${workItemId}: ${(error as Error).message}` });
      }
      return null;
    };

    const refreshEscalations = async () => {
      if (!client) {
        return;
      }
      try {
        const result = await client.listEscalations();
        app.setEscalations(result.escalations as Parameters<typeof app.setEscalations>[0]);
      } catch (error) {
        app.addEvent('error', { message: `Failed to load escalations: ${(error as Error).message}` });
      }
    };

    const refreshSchedulerCapabilities = async () => {
      if (!client) {
        return;
      }
      try {
        const capabilities = await client.getSystemCapabilities();
        setSchedulerCapabilities(capabilities);
      } catch (error) {
        app.addEvent('error', {
          message: `Failed to load scheduler capabilities: ${(error as Error).message}`,
        });
      }
    };

    // Update state based on event type
    switch (event.event) {
      case 'goal.created':
        if (data?.goal) {
          addGoal(data.goal as Parameters<typeof addGoal>[0]);
          const goal = data.goal as { id: string };
          updateSimpleMessageByGoalId(goal.id, {
            status: 'processing',
            statusText: 'Queued...',
          });
          appendTimelineByGoalId(goal.id, 'Intent parsed', 'Task created and queued.');
        } else if (typeof data?.goalId === 'string') {
          void upsertGoalById(data.goalId);
          updateSimpleMessageByGoalId(data.goalId, {
            status: 'processing',
            statusText: 'Queued...',
          });
          appendTimelineByGoalId(data.goalId, 'Intent parsed', 'Task created and queued.');
        }
        break;

      case 'goal.deleted':
        if (typeof data?.goalId === 'string') {
          app.removeGoal(data.goalId);
          const linkedMessages = app.state.simpleMessages.filter((m) => m.goalId === data.goalId);
          for (const message of linkedMessages) {
            app.removeSimpleMessage(message.id);
          }
        }
        break;

      case 'goal.started':
        if (data?.goal) {
          updateGoal(data.goal as Parameters<typeof updateGoal>[0]);
          const goal = data.goal as { id: string };
          updateSimpleMessageByGoalId(goal.id, {
            status: 'processing',
            statusText: 'Executing...',
          });
          appendTimelineByGoalId(goal.id, 'Execution started', 'Scheduler picked up the task.');
        } else if (typeof data?.goalId === 'string') {
          void upsertGoalById(data.goalId);
          updateSimpleMessageByGoalId(data.goalId, {
            status: 'processing',
            statusText: 'Executing...',
          });
          appendTimelineByGoalId(data.goalId, 'Execution started', 'Scheduler picked up the task.');
        }
        break;

      case 'goal.updated':
        if (data?.goal) {
          updateGoal(data.goal as Parameters<typeof updateGoal>[0]);
        } else if (typeof data?.goalId === 'string') {
          void upsertGoalById(data.goalId);
        }
        break;

      case 'goal.completed':
        if (data?.goal) {
          updateGoal(data.goal as Parameters<typeof updateGoal>[0]);
          const goal = data.goal as { id: string };
          updateSimpleMessageByGoalId(goal.id, {
            status: 'completed',
          });
          appendTimelineByGoalId(goal.id, 'Final result generated', 'Task marked completed.');
        } else if (typeof data?.goalId === 'string') {
          void upsertGoalById(data.goalId);
          updateSimpleMessageByGoalId(data.goalId, {
            status: 'completed',
          });
          appendTimelineByGoalId(data.goalId, 'Final result generated', 'Task marked completed.');
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
          appendTimelineByGoalId(goal.id, 'Execution failed', goal.error || 'Execution failed');
        } else if (typeof data?.goalId === 'string') {
          void upsertGoalById(data.goalId);
          updateSimpleMessageByGoalId(data.goalId, {
            status: 'failed',
            error: typeof data?.error === 'string' ? data.error : 'Execution failed',
          });
          appendTimelineByGoalId(data.goalId, 'Execution failed', typeof data?.error === 'string' ? data.error : 'Execution failed');
        }
        break;

      case 'workitem.created':
      case 'workitem.completed':
      case 'workitem.failed':
        if (data?.workItem) {
          app.updateWorkItem(data.workItem as Parameters<typeof app.updateWorkItem>[0]);
          const workItem = data.workItem as { goal_id?: string; id: string; title?: string; status?: string };
          if (workItem.goal_id) {
            appendTimelineByGoalId(workItem.goal_id, 'Work item update', `${workItem.title || workItem.id} [${workItem.status || 'updated'}]`);
          }
        } else if (typeof data?.workItemId === 'string') {
          void upsertWorkItemById(data.workItemId);
          if (typeof data?.goalId === 'string') {
            appendTimelineByGoalId(data.goalId, 'Work item update', `${data.workItemId} state changed.`);
          }
        }
        break;

      case 'workitem.started':
        if (data?.workItem) {
          app.updateWorkItem(data.workItem as Parameters<typeof app.updateWorkItem>[0]);
          const workItem = data.workItem as { goal_id: string; title: string };
          updateSimpleMessageByGoalId(workItem.goal_id, {
            status: 'processing',
            statusText: `Processing: ${workItem.title}...`,
            workItemId: typeof data?.workItemId === 'string' ? data.workItemId : undefined,
          });
          appendTimelineByGoalId(workItem.goal_id, 'Calling tools', `Working on: ${workItem.title}`);
        } else if (typeof data?.workItemId === 'string') {
          void upsertWorkItemById(data.workItemId).then((workItem) => {
            if (workItem) {
              updateSimpleMessageByGoalId(workItem.goal_id, {
                status: 'processing',
                statusText: `Processing: ${workItem.title}...`,
                workItemId: workItem.id,
              });
              appendTimelineByGoalId(workItem.goal_id, 'Calling tools', `Working on: ${workItem.title}`);
            } else if (typeof data?.goalId === 'string') {
              const workItemId = typeof data?.workItemId === 'string' ? data.workItemId : undefined;
              updateSimpleMessageByGoalId(data.goalId, {
                status: 'processing',
                statusText: 'Processing work item...',
                workItemId,
              });
              appendTimelineByGoalId(data.goalId, 'Calling tools', workItemId ? `Work item ${workItemId} started.` : 'Work item started.');
            }
          });
        }
        break;

      case 'workitem.in_progress':
        if (typeof data?.goalId === 'string') {
          const stage = typeof data?.stage === 'string' ? data.stage : 'execution';
          const progress = typeof data?.progress === 'number' ? `${data.progress}%` : undefined;
          updateSimpleMessageByGoalId(data.goalId, {
            status: 'processing',
            statusText: progress ? `${stage} (${progress})` : stage,
          });
          appendTimelineByGoalId(
            data.goalId,
            'Execution update',
            progress ? `${stage} ${progress}` : stage
          );
        }
        break;

      case 'workitem.ended':
        if (typeof data?.goalId === 'string') {
          const outcome = typeof data?.outcome === 'string' ? data.outcome : 'completed';
          appendTimelineByGoalId(data.goalId, 'Work item ended', `Outcome: ${outcome}`);
        }
        break;

      case 'run.started':
        if (typeof data?.goalId === 'string') {
          updateSimpleMessageByGoalId(data.goalId, {
            status: 'processing',
            statusText: 'Collecting tool results...',
            runId: typeof data?.runId === 'string' ? data.runId : undefined,
            workItemId: typeof data?.workItemId === 'string' ? data.workItemId : undefined,
          });
          appendTimelineByGoalId(data.goalId, 'Collecting results', typeof data?.runId === 'string' ? `Run ${data.runId} started.` : 'Run started.');
        }
        break;

      case 'run.completed':
        if (typeof data?.goalId === 'string') {
          appendTimelineByGoalId(data.goalId, 'Tool results collected', 'Run completed, building final summary.');
          void attachRunResultByGoalId(
            data.goalId,
            typeof data?.workItemId === 'string' ? data.workItemId : undefined,
            typeof data?.runId === 'string' ? data.runId : undefined
          );
        }
        break;

      case 'verification.completed':
        if (typeof data?.goalId === 'string') {
          appendTimelineByGoalId(
            data.goalId,
            'Verification complete',
            typeof data?.summary === 'string' ? data.summary : (data?.passed === true ? 'Verification passed.' : 'Verification failed.')
          );
          if (typeof data?.summary === 'string') {
            updateSimpleMessageByGoalId(data.goalId, { resultSummary: data.summary });
          }
        }
        break;

      case 'task.narration':
        if (typeof data?.goalId === 'string') {
          appendTimelineByGoalId(
            data.goalId,
            typeof data?.stage === 'string' ? data.stage : 'Execution update',
            typeof data?.message === 'string' ? data.message : undefined
          );
          if (typeof data?.statusText === 'string') {
            updateSimpleMessageByGoalId(data.goalId, { statusText: data.statusText, status: 'processing' });
          }
        } else {
          appendTimelineLatest(
            typeof data?.stage === 'string' ? data.stage : 'Execution update',
            typeof data?.message === 'string' ? data.message : undefined
          );
          if (typeof data?.statusText === 'string') {
            updateLatestProcessingMessage({ statusText: data.statusText, status: 'processing' });
          }
        }
        break;

      case 'task.result':
        if (typeof data?.goalId === 'string') {
          updateSimpleMessageByGoalId(data.goalId, {
            resultSummary: typeof data?.summary === 'string' ? data.summary : undefined,
            actions: typeof data?.summary === 'string' ? extractActionHints(data.summary) : undefined,
            status: typeof data?.success === 'boolean' ? (data.success ? 'completed' : 'failed') : undefined,
          });
          appendTimelineByGoalId(data.goalId, 'Final result generated', typeof data?.summary === 'string' ? data.summary : undefined);
        } else {
          updateLatestProcessingMessage({
            resultSummary: typeof data?.summary === 'string' ? data.summary : undefined,
            actions: typeof data?.summary === 'string' ? extractActionHints(data.summary) : undefined,
            status: typeof data?.success === 'boolean' ? (data.success ? 'completed' : 'failed') : undefined,
          });
          appendTimelineLatest('Final result generated', typeof data?.summary === 'string' ? data.summary : undefined);
        }
        break;

      case 'escalation.created':
        if (data?.escalation) {
          addEscalation(data.escalation as Parameters<typeof addEscalation>[0]);
          // Show escalation warning for the related goal
          const escalation = data.escalation as { goal_id?: string };
          if (escalation.goal_id) {
            updateSimpleMessageByGoalId(escalation.goal_id, {
              status: 'processing',
              statusText: '⚠ Needs confirmation',
            });
          }
        } else {
          void refreshEscalations();
          if (typeof data?.goalId === 'string') {
            updateSimpleMessageByGoalId(data.goalId, {
              status: 'processing',
              statusText: '⚠ Needs confirmation',
            });
          }
        }
        break;

      case 'escalation.resolved':
        if (data?.escalationId) {
          app.removeEscalation(data.escalationId as string);
        } else {
          void refreshEscalations();
        }
        break;

      case 'system.status':
      case 'scheduler.disconnected':
        void refreshSchedulerCapabilities();
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
      onClientReady={(client) => {
        clientRef.current = client;
      }}
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
