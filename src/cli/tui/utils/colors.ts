/**
 * TUI Color utilities
 */

import type { GoalStatus, WorkItemStatus, EscalationSeverity } from '../../../work-order/types/index.js';
import type { ConnectionStatus } from '../store/types.js';

export const COLORS = {
  // Brand colors
  primary: 'cyan',
  secondary: 'blue',
  accent: 'magenta',

  // Status colors
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',

  // Text colors
  text: 'white',
  textDim: 'gray',
  textMuted: 'gray',

  // UI colors
  border: 'gray',
  borderFocus: 'cyan',
  background: 'black',
} as const;

export function getConnectionStatusColor(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return COLORS.success;
    case 'connecting':
      return COLORS.warning;
    case 'disconnected':
    case 'error':
      return COLORS.error;
    default:
      return COLORS.textDim;
  }
}

export function getGoalStatusColor(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return COLORS.success;
    case 'queued':
      return COLORS.info;
    case 'blocked':
      return COLORS.warning;
    case 'completed':
      return COLORS.textDim;
    case 'cancelled':
      return COLORS.error;
    default:
      return COLORS.textDim;
  }
}

export function getWorkItemStatusColor(status: WorkItemStatus): string {
  switch (status) {
    case 'in_progress':
      return COLORS.success;
    case 'ready':
      return COLORS.info;
    case 'queued':
      return COLORS.textDim;
    case 'verify':
      return COLORS.warning;
    case 'done':
      return COLORS.success;
    case 'failed':
      return COLORS.error;
    case 'blocked':
      return COLORS.warning;
    default:
      return COLORS.textDim;
  }
}

export function getEscalationSeverityColor(severity: EscalationSeverity): string {
  switch (severity) {
    case 'critical':
      return COLORS.error;
    case 'high':
      return COLORS.warning;
    case 'medium':
      return COLORS.info;
    case 'low':
      return COLORS.textDim;
    default:
      return COLORS.textDim;
  }
}

export function getEventTypeColor(eventType: string): string {
  if (eventType.includes('error') || eventType.includes('failed')) {
    return COLORS.error;
  }
  if (eventType.includes('completed') || eventType.includes('success')) {
    return COLORS.success;
  }
  if (eventType.includes('started') || eventType.includes('created')) {
    return COLORS.info;
  }
  if (eventType.includes('warning') || eventType.includes('blocked')) {
    return COLORS.warning;
  }
  return COLORS.accent;
}
