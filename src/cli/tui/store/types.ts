/**
 * TUI State Types
 */

import type { Goal, WorkItem, Escalation } from '../../../work-order/types/index.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type ViewType = 'dashboard' | 'goals' | 'events' | 'help';

export type DisplayMode = 'simple' | 'expert';

export type SimpleMessageStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface SimpleMessage {
  id: string;
  input: string;
  status: SimpleMessageStatus;
  statusText?: string;
  goalId?: string;
  error?: string;
  timestamp: number;
}

export interface GatewayEvent {
  id: string;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface AppState {
  // Display mode
  displayMode: DisplayMode;

  // Simple mode messages
  simpleMessages: SimpleMessage[];

  // Connection
  connectionStatus: ConnectionStatus;
  gatewayUrl: string;

  // Current view
  currentView: ViewType;

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

  // Events
  events: GatewayEvent[];
  maxEvents: number;

  // Activity
  activityStatus: string;

  // Modals
  activeModal: ModalType | null;
  modalData: unknown;

  // Input
  inputValue: string;
  inputHistory: string[];
  inputHistoryIndex: number;
}

export type ModalType =
  | 'goal-create'
  | 'goal-detail'
  | 'escalation'
  | 'approval'
  | 'confirm';

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
  };
}

export const initialState: AppState = {
  displayMode: 'simple',
  simpleMessages: [],
  connectionStatus: 'connecting',
  gatewayUrl: 'ws://127.0.0.1:18789',
  currentView: 'dashboard',
  goals: [],
  selectedGoalId: null,
  goalsLoading: false,
  workItems: [],
  workItemsLoading: false,
  escalations: [],
  escalationsLoading: false,
  pendingEscalationCount: 0,
  pendingApprovalCount: 0,
  events: [],
  maxEvents: 100,
  activityStatus: 'idle',
  activeModal: null,
  modalData: null,
  inputValue: '',
  inputHistory: [],
  inputHistoryIndex: -1,
};
