import type { CachedGoal } from '@/lib/types';
import { GoalCard } from './goal-card';

interface GoalListProps {
  goals: CachedGoal[];
}

export function GoalList({ goals }: GoalListProps) {
  if (goals.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No goals found
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {goals.map((goal) => (
        <GoalCard key={goal.id} goal={goal} />
      ))}
    </div>
  );
}
