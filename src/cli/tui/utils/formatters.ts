/**
 * TUI Formatting utilities
 */

import type { GoalStatus, WorkItemStatus, EscalationSeverity } from '../../../work-order/types/index.js';

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return `${formatDate(timestamp)} ${formatTimestamp(timestamp)}`;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  if (seconds > 10) {
    return `${seconds}s ago`;
  }
  return 'just now';
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function formatGoalStatus(status: GoalStatus): string {
  const icons: Record<GoalStatus, string> = {
    queued: '○',
    active: '●',
    blocked: '◐',
    completed: '✓',
    cancelled: '✗',
  };
  return `${icons[status] || '?'} ${status}`;
}

export function formatWorkItemStatus(status: WorkItemStatus): string {
  const icons: Record<WorkItemStatus, string> = {
    queued: '○',
    ready: '◎',
    in_progress: '▶',
    verify: '◐',
    done: '✓',
    failed: '✗',
    blocked: '⊘',
  };
  return `${icons[status] || '?'} ${status}`;
}

export function formatEscalationSeverity(severity: EscalationSeverity): string {
  const icons: Record<EscalationSeverity, string> = {
    low: '○',
    medium: '◐',
    high: '●',
    critical: '⚠',
  };
  return `${icons[severity] || '?'} ${severity}`;
}

export function formatProgress(current: number, total: number): string {
  if (total === 0) return '0%';
  const percent = Math.round((current / total) * 100);
  return `${percent}%`;
}

export function formatProgressBar(current: number, total: number, width: number = 10): string {
  if (total === 0) return '░'.repeat(width);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

export function padRight(str: string, length: number): string {
  if (str.length >= length) return str;
  return str + ' '.repeat(length - str.length);
}

export function padLeft(str: string, length: number): string {
  if (str.length >= length) return str;
  return ' '.repeat(length - str.length) + str;
}

export function formatCount(count: number, singular: string, plural?: string): string {
  const p = plural || `${singular}s`;
  return `${count} ${count === 1 ? singular : p}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function getGoalStatusIcon(status: GoalStatus): string {
  const icons: Record<GoalStatus, string> = {
    queued: '○',
    active: '●',
    blocked: '◐',
    completed: '✓',
    cancelled: '✗',
  };
  return icons[status] || '?';
}

export function getWorkItemStatusIcon(status: WorkItemStatus): string {
  const icons: Record<WorkItemStatus, string> = {
    queued: '○',
    ready: '◎',
    in_progress: '▶',
    verify: '◐',
    done: '✓',
    failed: '✗',
    blocked: '⊘',
  };
  return icons[status] || '?';
}

export function getEventIcon(eventType: string): string {
  if (eventType.includes('error') || eventType.includes('failed')) {
    return '✗';
  }
  if (eventType.includes('completed') || eventType.includes('success') || eventType.includes('done')) {
    return '✓';
  }
  if (eventType.includes('started') || eventType.includes('created')) {
    return '▶';
  }
  if (eventType.includes('warning') || eventType.includes('blocked')) {
    return '⚠';
  }
  return '●';
}
