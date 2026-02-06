'use client';

import { Badge } from '@/components/ui/badge';
import type { WorkItemStatus, GoalStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: WorkItemStatus | GoalStatus;
  size?: 'sm' | 'default';
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  // Goal statuses
  queued: { label: 'Queued', variant: 'secondary' },
  active: { label: 'Active', variant: 'default', className: 'bg-blue-500 hover:bg-blue-600' },
  blocked: { label: 'Blocked', variant: 'destructive', className: 'bg-orange-500 hover:bg-orange-600' },
  completed: { label: 'Completed', variant: 'default', className: 'bg-green-500 hover:bg-green-600' },
  cancelled: { label: 'Cancelled', variant: 'outline' },

  // WorkItem statuses
  ready: { label: 'Ready', variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'default', className: 'bg-blue-500 hover:bg-blue-600' },
  verify: { label: 'Verifying', variant: 'default', className: 'bg-purple-500 hover:bg-purple-600' },
  done: { label: 'Done', variant: 'default', className: 'bg-green-500 hover:bg-green-600' },
  failed: { label: 'Failed', variant: 'destructive' },
};

export function StatusBadge({ status, size = 'default' }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: 'outline' as const };

  return (
    <Badge
      variant={config.variant}
      className={`${config.className || ''} ${size === 'sm' ? 'text-xs px-1.5 py-0' : ''}`}
    >
      {config.label}
    </Badge>
  );
}
