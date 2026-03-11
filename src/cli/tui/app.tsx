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
import { DashboardView, WorkstreamView, GoalsView, SessionsView, EventsView, HelpView } from './components/views/index.js';
import { GoalCreateModal, EscalationModal, ConfirmModal, CommandPaletteModal, ViewSwitcherModal, ModelSelectorModal } from './components/modals/index.js';
import { executeCommand, handleNaturalInput, isCommand, type CommandContext } from './commands/index.js';
import type { GatewayEvent as ClientGatewayEvent, TuiGatewayClient } from '../gateway/index.js';
import { useTerminalSize } from './hooks/use-terminal-size.js';
import type { ViewType } from './store/types.js';
import { getNextReasoningEffortIndex } from './model-variant.js';
import { resolveInitialAgentIndex } from './utils/agent-selection.js';
import { isGatewayCompatibilityEventType } from '../../gateway/compatibility.js';
import { handleTaskCompatibilityEvent } from './task-event-compatibility.js';

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
  const { state, setView, addEvent, setInputFocused: setGlobalInputFocused } = app;
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [selectedReasoningEffortIndex, setSelectedReasoningEffortIndex] = useState(0);
  const [runtimeMainAgentId, setRuntimeMainAgentId] = useState<string | null>(null);
  const [runtimeConfigReady, setRuntimeConfigReady] = useState(false);

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

    if (key.tab) {
      const agents = state.schedulerCapabilities?.capabilities.agents || [];
      if (agents.length > 0) {
        setSelectedAgentIndex((index) => (index + 1) % agents.length);
      }
      return;
    }

    if (key.ctrl && input === 'v') {
      app.openModal('view-switcher', {
        onSelect: (view: ViewType) => setView(view),
      });
      return;
    }

    if (key.ctrl && ['1', '2', '3', '4'].includes(input)) {
      return;
    }

    if (key.ctrl && input === 'n') {
      void (async () => {
        const result = await executeCommand('/new', commandContext);
        if (result.error) {
          addEvent('command.error', { command: '/new', error: result.error });
        } else if (result.message) {
          addEvent('command.success', { command: '/new', message: result.message });
        }
      })();
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

    if (key.ctrl && input === 'p') {
      app.openModal('command-palette', {
        onExecute: async (command: string) => {
          const result = await executeCommand(command, commandContext);
          if (result.error) {
            addEvent('command.error', { command, error: result.error });
          } else if (result.message) {
            addEvent('command.success', { command, message: result.message });
          }
        },
      });
      return;
    }

    if (key.ctrl && input === 't') {
      const models = state.schedulerCapabilities?.capabilities.models || [];
      const activeModel = models[0];
      const reasoningEfforts = activeModel?.reasoningEfforts || [];
      if (reasoningEfforts.length > 1) {
        setSelectedReasoningEffortIndex((index) => getNextReasoningEffortIndex(reasoningEfforts, index));
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

  }, [commandContext]);

  useEffect(() => {
    setGlobalInputFocused(true);
  }, [setGlobalInputFocused]);

  const footerStatus = useMemo(() => {
    const agents = state.schedulerCapabilities?.capabilities.agents || [];
    const models = state.schedulerCapabilities?.capabilities.models || [];

    const activeAgent = agents.length > 0 ? agents[selectedAgentIndex % agents.length] : null;
    const activeModel = models.length > 0 ? models[0] : null;
    const selectedModel = state.selectedModel;
    const modelLabel = selectedModel || (activeModel ? activeModel.name : 'model.unknown');
    const activeVariant = activeModel?.reasoningEfforts?.[
      selectedReasoningEffortIndex % Math.max(activeModel?.reasoningEfforts?.length || 1, 1)
    ];
    const variantSegment = activeModel?.reasoningEfforts && activeModel.reasoningEfforts.length > 0
      ? ` ${activeVariant || activeModel.reasoningEfforts[0]} <${(selectedReasoningEffortIndex % activeModel.reasoningEfforts.length) + 1}/${activeModel.reasoningEfforts.length}>`
      : '';
    const variantHint = activeModel?.reasoningEfforts && activeModel.reasoningEfforts.length > 1 ? 'ctrl-t variants ' : '';
    return `A ${activeAgent?.id || 'guard'} │ M ${modelLabel}${variantSegment} │ ${variantHint}tab agents ctrl-v views ctrl-p commands`;
  }, [state.schedulerCapabilities, state.selectedModel, selectedAgentIndex, selectedReasoningEffortIndex]);

  useEffect(() => {
    const agents = state.schedulerCapabilities?.capabilities.agents || [];
    if (agents.length === 0) {
      app.setSelectedAgentId(null);
      app.setSelectedModel(null);
      return;
    }

    const activeAgent = agents[selectedAgentIndex % agents.length];
    const activeAgentId = activeAgent?.id ?? null;
    app.setSelectedAgentId(activeAgentId);

    const client = gatewayRef.current.client;
    if (!client || !activeAgentId) {
      return;
    }

    void client.getAgentModelOverride({ agentId: activeAgentId })
      .then((result) => {
        appRef.current.setSelectedModel(result.model);
      })
      .catch((err) => {
        appRef.current.addEvent('model.selection.load_failed', {
          agentId: activeAgentId,
          error: (err as Error).message,
        });
      });
  }, [selectedAgentIndex, state.schedulerCapabilities, gateway.connectionStatus]);

  // Track if initial data has been loaded
  const initialLoadDone = useRef(false);
  const initialAgentSelectionApplied = useRef(false);

  useEffect(() => {
    if (!runtimeConfigReady || initialAgentSelectionApplied.current) {
      return;
    }

    const agents = state.schedulerCapabilities?.capabilities.agents || [];
    if (agents.length === 0) {
      return;
    }

    setSelectedAgentIndex((index) => resolveInitialAgentIndex(agents, runtimeMainAgentId, index));

    initialAgentSelectionApplied.current = true;
  }, [runtimeConfigReady, runtimeMainAgentId, state.schedulerCapabilities]);

  // Load initial data when connected
  useEffect(() => {
    const { connectionStatus, client } = gatewayRef.current;
    if (connectionStatus === 'connected' && client && !initialLoadDone.current) {
      initialLoadDone.current = true;

      client.listConversationSessions({ limit: 20, lifecycleState: 'active' }).then(result => {
        const normalizedSessions = result.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          state: session.state,
          lifecycleState: session.lifecycleState,
          archivedAt: session.archivedAt,
          archiveSummary: session.archiveSummary,
          turnCount: session.turnCount,
          lastMessage: session.lastMessage,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        }));
        appRef.current.setSessions(normalizedSessions);

        if (!appRef.current.state.activeSessionId && normalizedSessions.length > 0) {
          const initialSession = normalizedSessions[0];
          appRef.current.setActiveSession(initialSession.id, initialSession.title ?? null);
        }
      }).catch(err => {
        appRef.current.addEvent('error', { message: `Failed to load sessions: ${err.message}` });
      });

      // Load goals
      const effectiveSessionId = appRef.current.state.activeSessionId ?? null;
      client.listGoals(effectiveSessionId ? { sessionId: effectiveSessionId } : undefined).then(result => {
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

      client.getInternalRuntimeConfig().then((runtimeConfig) => {
        appRef.current.setRuntimeTuiConfig(runtimeConfig.tui);
        setRuntimeMainAgentId(runtimeConfig.agent?.mainAgentId ?? null);
        setRuntimeConfigReady(true);
      }).catch((err) => {
        appRef.current.addEvent('error', { message: `Failed to load runtime tui config: ${err.message}` });
        setRuntimeConfigReady(true);
      });
    }
  }, [gateway.connectionStatus]);

  // Render current view
  const renderCurrentView = () => {
    switch (state.currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'tasks':
        return <WorkstreamView />;
      case 'goals':
        return <GoalsView />;
      case 'sessions':
        return <SessionsView />;
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
      case 'command-palette':
        return <CommandPaletteModal />;
      case 'view-switcher':
        return <ViewSwitcherModal />;
      case 'model-selector':
        return <ModelSelectorModal />;
      default:
        return null;
    }
  };

  // Render based on display mode
  const renderContent = () => (
    <MainLayout
      onInputSubmit={handleInputSubmit}
      inputFocus={state.currentView === 'dashboard' && !state.activeModal && state.inputFocused}
      showInputBar={true}
      footerStatus={footerStatus}
    >
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
        const runs = runsResp.runs || [];
        const run = runId
          ? runs.find((r) => r.ids.runId === runId)
          : runs[runs.length - 1];
        const log = run?.output.executionLog;
        const summary = run?.output.summary || firstMeaningfulLine(log) || run?.output.errorMessage;

        const message = app.state.simpleMessages.find(m => m.goalId === goalId);
        if (!message) return;

        app.updateSimpleMessage(message.id, {
          workItemId,
          runId: run?.ids.runId,
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

    if (isGatewayCompatibilityEventType(event.event)) {
      handleTaskCompatibilityEvent(event.event, data, {
        updateSimpleMessageByGoalId,
        appendTimelineByGoalId,
        updateLatestProcessingMessage,
        appendTimelineLatest,
        extractActionHints,
      });
      return;
    }

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
          if (typeof data?.selectedModel === 'string') {
            app.setSelectedModel(data.selectedModel);
          }
          appendTimelineByGoalId(data.goalId, 'Collecting results', typeof data?.runId === 'string' ? `Run ${data.runId} started.` : 'Run started.');
        }
        break;

      case 'run.completed':
        if (typeof data?.goalId === 'string') {
          if (typeof data?.actualModel === 'string') {
            app.setSelectedModel(data.actualModel);
          }
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

      case 'conversation.new':
        if (typeof data?.sessionId === 'string') {
          const summary = app.state.sessions.find((session) => session.id === data.sessionId);
          app.setActiveSession(data.sessionId, summary?.title ?? null);
        }
        if (client) {
          void client.listConversationSessions({ limit: 20, lifecycleState: 'active' }).then(result => {
            app.setSessions(result.sessions.map((session) => ({
              id: session.id,
              title: session.title,
              state: session.state,
              lifecycleState: session.lifecycleState,
              archivedAt: session.archivedAt,
              archiveSummary: session.archiveSummary,
              turnCount: session.turnCount,
              lastMessage: session.lastMessage,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
            })));
          });
        }
        break;

      case 'conversation.response':
        if (typeof data?.sessionId === 'string' && !app.state.activeSessionId) {
          app.setActiveSession(data.sessionId, null);
        }
        if (client) {
          void client.listConversationSessions({ limit: 20, lifecycleState: 'active' }).then(result => {
            app.setSessions(result.sessions.map((session) => ({
              id: session.id,
              title: session.title,
              state: session.state,
              lifecycleState: session.lifecycleState,
              archivedAt: session.archivedAt,
              archiveSummary: session.archiveSummary,
              turnCount: session.turnCount,
              lastMessage: session.lastMessage,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
            })));
          });
        }
        break;

      case 'conversation.archived':
      case 'conversation.resumed':
        if (client) {
          void client.listConversationSessions({ limit: 20, lifecycleState: 'active' }).then(result => {
            app.setSessions(result.sessions.map((session) => ({
              id: session.id,
              title: session.title,
              state: session.state,
              lifecycleState: session.lifecycleState,
              archivedAt: session.archivedAt,
              archiveSummary: session.archiveSummary,
              turnCount: session.turnCount,
              lastMessage: session.lastMessage,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
            })));
          });
        }
        if (event.event === 'conversation.archived' && typeof data?.sessionId === 'string' && app.state.activeSessionId === data.sessionId) {
          app.setActiveSession(null, null);
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
