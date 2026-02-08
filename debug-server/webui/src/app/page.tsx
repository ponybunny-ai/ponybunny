'use client';

import { useEffect } from 'react';
import { useDebug } from '@/components/providers/debug-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricsPanel } from '@/components/metrics/metrics-panel';
import { EventList } from '@/components/events/event-list';
import { GoalList } from '@/components/goals/goal-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function HomePage() {
  const { state, loadHealth, loadEvents, loadGoals, loadMetrics } = useDebug();

  useEffect(() => {
    // Initial data load
    loadHealth();
    loadEvents({ limit: 20 });
    loadGoals();
    loadMetrics();

    // Refresh health and metrics periodically
    const healthInterval = setInterval(loadHealth, 5000);
    const metricsInterval = setInterval(loadMetrics, 10000);

    return () => {
      clearInterval(healthInterval);
      clearInterval(metricsInterval);
    };
  }, [loadHealth, loadEvents, loadGoals, loadMetrics]);

  const recentGoals = Array.from(state.goals.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Debug Dashboard</h1>
        <p className="text-muted-foreground">
          Real-time monitoring of PonyBunny system events and metrics
        </p>
      </div>

      {state.metrics && (
        <div>
          <h2 className="mb-4 text-xl font-semibold">System Metrics</h2>
          <MetricsPanel metrics={state.metrics} />
        </div>
      )}

      <Tabs defaultValue="events" className="w-full">
        <TabsList>
          <TabsTrigger value="events">Recent Events</TabsTrigger>
          <TabsTrigger value="goals">Active Goals</TabsTrigger>
        </TabsList>

        <TabsContent value="events">
          <Card>
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
            </CardHeader>
            <CardContent>
              <EventList events={state.events.slice(0, 20)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="goals">
          <Card>
            <CardHeader>
              <CardTitle>Active Goals</CardTitle>
            </CardHeader>
            <CardContent>
              <GoalList goals={recentGoals} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
