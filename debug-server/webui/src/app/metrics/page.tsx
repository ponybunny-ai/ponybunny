'use client';

import { useEffect } from 'react';
import { useDebug } from '@/components/providers/debug-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricsPanel } from '@/components/metrics/metrics-panel';

export default function MetricsPage() {
  const { state, loadMetrics } = useDebug();

  useEffect(() => {
    loadMetrics();

    // Refresh metrics every 10 seconds
    const interval = setInterval(loadMetrics, 10000);
    return () => clearInterval(interval);
  }, [loadMetrics]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Metrics</h1>
        <p className="text-muted-foreground">
          System performance and usage metrics
        </p>
      </div>

      {state.metrics ? (
        <div className="space-y-6">
          <MetricsPanel metrics={state.metrics} />

          <Card>
            <CardHeader>
              <CardTitle>Event Type Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(state.metrics.data.eventCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <span className="text-sm font-medium">{type}</span>
                      <span className="text-sm text-muted-foreground">
                        {count} events
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="flex h-64 items-center justify-center">
            <p className="text-muted-foreground">Loading metrics...</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
