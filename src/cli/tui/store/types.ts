/**
 * TUI State Types
 */

import type { Goal, WorkItem, Escalation } from '../../../work-order/types/index.js';
import type { SchedulerCapabilitiesResponse } from '../../gateway/tui-gateway-client.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type ViewType = 'dashboard' | 'tasks' | 'goals' | 'sessions' | 'events' | 'help';

export type SimpleMessageStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SimpleMessage {
  id: string;
  input: string;
  source?: 'conversation' | 'goal';
  status: SimpleMessageStatus;
  statusText?: string;
  goalId?: string;
  sessionId?: string;
  workItemId?: string;
  runId?: string;
  timeline: Array<{
    timestamp: number;
    stage: string;
    detail?: string;
  }>;
  resultSummary?: string;
  actions?: Array<{
    label: string;
    kind: 'file' | 'url' | 'command';
    target: string;
  }>;
  error?: string;
  timestamp: number;
}

export interface GatewayEvent {
  id: string;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface SessionSummary {
  id: string;
  title?: string;
  state: string;
  lifecycleState: string;
  archivedAt?: number;
  archiveSummary?: string;
  turnCount: number;
  lastMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionHistoryPreview {
  sessionId: string;
  totalTurns: number;
  returnedTurns: number;
  roleFilter: 'all' | 'user' | 'assistant' | 'system';
  limit: number;
  offset: number;
  previewLines: number;
  generatedAt: number;
  source: 'command' | 'sessions_view';
  previewText: string;
}

export interface RuntimeSnapshot {
  id: string;
  timestamp: number;
  goalId: string;
  runId?: string;
  source: 'runtime_refresh' | 'replay_command';
  config: {
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
    runtimeRollout: {
      shadowModeEnabled: boolean;
      canaryPercent: number;
      rollbackOnFailure: boolean;
      lanePercents: {
        dryRun: number;
        compile: number;
        replay: number;
      };
    };
  };
  dryRun: {
    ok: boolean;
    status?: string;
    compileRunId?: string;
    runtimeRunId?: string;
    totalEvents?: number;
    factsCount?: number;
    artifactsCount?: number;
    reexecution?: {
      attemptedSteps: number;
      eligibleSteps: number;
      executedSteps: number;
      skippedSteps: number;
    };
    replayPage?: {
      returned: number;
      offset: number;
      cursor?: string;
      nextOffset?: number;
      nextCursor?: string;
    };
  };
}

export interface RuntimeTuiConfig {
  inputBackgroundColor: 'gray' | 'black' | 'blue' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'white';
  sessionFirstEnabled: boolean;
  goalSubmitFastPathEnabled: boolean;
}

export interface AppState {
  // Message stream
  simpleMessages: SimpleMessage[];

  // Connection
  connectionStatus: ConnectionStatus;
  gatewayUrl: string;

  // Current view
  currentView: ViewType;

  activeSessionId: string | null;
  activeSessionTitle: string | null;
  sessions: SessionSummary[];
  sessionsLifecycleFilter: 'active' | 'archived';
  sessionsSearchQuery: string;
  sessionsSortMode: 'updated' | 'history_freshness';
  sessionHistoryPreviews: Record<string, SessionHistoryPreview>;

  // Goals
  goals: Goal[];
  selectedGoalId: string | null;
  goalsLoading: boolean;

  // Work Items
  workItems: WorkItem[];
  workItemsLoading: boolean;

  // Escalations
  escalations: Escalation[];
  escalationsLoading: boolean;
  pendingEscalationCount: number;

  // Approvals
  pendingApprovalCount: number;
  schedulerCapabilities: SchedulerCapabilitiesResponse | null;
  selectedAgentId: string | null;
  selectedModel: string | null;

  // Events
  events: GatewayEvent[];
  maxEvents: number;
  eventsFilter: 'all' | 'goal' | 'workitem' | 'escalation' | 'system' | 'conversation';
  eventsSearchQuery: string;

  runtimeSnapshots: RuntimeSnapshot[];
  runtimeTuiConfig: RuntimeTuiConfig | null;

  // Activity
  activityStatus: string;

  // Modals
  activeModal: ModalType | null;
  modalData: unknown;

  // Input
  inputValue: string;
  inputHistory: string[];
  inputHistoryIndex: number;
  inputFocused: boolean;
}

export type ModalType =
  | 'goal-create'
  | 'goal-detail'
  | 'escalation'
  | 'approval'
  | 'confirm'
  | 'command-palette'
  | 'view-switcher'
  | 'model-selector';

export interface ModalData {
  'goal-create': undefined;
  'goal-detail': { goalId: string };
  'escalation': { escalationId: string };
  'approval': { approvalId: string };
  'confirm': {
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
  };
  'command-palette': {
    onExecute: (command: string) => Promise<void> | void;
  };
  'view-switcher': {
    onSelect: (view: ViewType) => void;
  };
  'model-selector': {
    selectedModel: string | null;
    onSelect: (model: string | null) => void;
  };
}

export const initialState: AppState = {
  simpleMessages: [],
  connectionStatus: 'connecting',
  gatewayUrl: 'ws://127.0.0.1:18789',
  currentView: 'dashboard',
  activeSessionId: null,
  activeSessionTitle: null,
  sessions: [],
  sessionsLifecycleFilter: 'active',
  sessionsSearchQuery: '',
  sessionsSortMode: 'updated',
  sessionHistoryPreviews: {},
  goals: [],
  selectedGoalId: null,
  goalsLoading: false,
  workItems: [],
  workItemsLoading: false,
  escalations: [],
  escalationsLoading: false,
  pendingEscalationCount: 0,
  pendingApprovalCount: 0,
  schedulerCapabilities: null,
  selectedAgentId: null,
  selectedModel: null,
  events: [],
  maxEvents: 100,
  eventsFilter: 'all',
  eventsSearchQuery: '',
  runtimeSnapshots: [],
  runtimeTuiConfig: null,
  activityStatus: 'idle',
  activeModal: null,
  modalData: null,
  inputValue: '',
  inputHistory: [],
  inputHistoryIndex: -1,
  inputFocused: true,
};
