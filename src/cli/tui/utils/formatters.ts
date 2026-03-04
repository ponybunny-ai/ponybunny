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

const ansiPattern = /\u001B\[[0-9;]*m/g;
const combiningMarkPattern = /\p{Mark}/u;
const zeroWidthPattern = /[\u200B-\u200D\uFE0E\uFE0F]/u;
const fullWidthPattern = /[\u1100-\u115F\u231A-\u231B\u2329-\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2614-\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA-\u26AB\u26BD-\u26BE\u26C4-\u26C5\u26CE\u26D4\u26EA\u26F2-\u26F3\u26F5\u26FA\u26FD\u2705\u270A-\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B-\u2B1C\u2B50\u2B55\u2E80-\u2E99\u2E9B-\u2EF3\u2F00-\u2FD5\u2FF0-\u2FFB\u3000-\u303E\u3041-\u3096\u3099-\u30FF\u3105-\u312F\u3131-\u318E\u3190-\u31E3\u31F0-\u321E\u3220-\u3247\u3250-\u32FE\u3300-\u4DBF\u4E00-\uA4C6\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6B\uFF01-\uFF60\uFFE0-\uFFE6\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F18E}\u{1F191}-\u{1F251}\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u;

function charDisplayWidth(char: string): number {
  if (char === '\n' || char === '\r') {
    return 0;
  }
  if (zeroWidthPattern.test(char) || combiningMarkPattern.test(char)) {
    return 0;
  }
  return fullWidthPattern.test(char) ? 2 : 1;
}

export function displayWidth(input: string): number {
  const plain = input.replace(ansiPattern, '');
  let width = 0;
  for (const char of plain) {
    width += charDisplayWidth(char);
  }
  return width;
}

export function truncateDisplayWidth(input: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return '';
  }
  const plain = input.replace(ansiPattern, '');
  if (displayWidth(plain) <= maxWidth) {
    return plain;
  }
  if (maxWidth === 1) {
    return '…';
  }

  const targetWidth = maxWidth - 1;
  let usedWidth = 0;
  let output = '';

  for (const char of plain) {
    const charWidth = charDisplayWidth(char);
    if (usedWidth + charWidth > targetWidth) {
      break;
    }
    output += char;
    usedWidth += charWidth;
  }

  return `${output}…`;
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
