import type { CachedGoal } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatTimestamp } from '@/lib/utils';
import Link from 'next/link';

interface GoalCardProps {
  goal: CachedGoal;
}

function getStatusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'error':
      return 'destructive';
    case 'in_progress':
    case 'executing':
      return 'warning';
    default:
      return 'default';
  }
}

export function GoalCard({ goal }: GoalCardProps) {
  return (
    <Link href={`/goals/${goal.id}`}>
      <Card className="cursor-pointer transition-colors hover:bg-accent">
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">
              {goal.title || goal.id}
            </CardTitle>
            <Badge variant={getStatusVariant(goal.status)}>
              {goal.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div>ID: {goal.id}</div>
            <div>Updated: {formatTimestamp(goal.updatedAt)}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
