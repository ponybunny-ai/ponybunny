'use client';

import { useEffect } from 'react';
import { useDebug } from '@/components/providers/debug-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GoalList } from '@/components/goals/goal-list';

export default function GoalsPage() {
  const { state, loadGoals } = useDebug();

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const goals = Array.from(state.goals.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Goals</h1>
        <p className="text-muted-foreground">
          All goals tracked by the debug server
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Goals ({goals.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <GoalList goals={goals} />
        </CardContent>
      </Card>
    </div>
  );
}
