import type { AggregatedMetrics } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
}

export function MetricCard({ title, value, description }: MetricCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

interface MetricsPanelProps {
  metrics: AggregatedMetrics;
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  const totalEvents = Object.values(metrics.data.eventCounts).reduce(
    (sum, count) => sum + count,
    0
  );

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Total Events"
        value={totalEvents}
        description="All events in this window"
      />

      {metrics.data.llmTokens && (
        <>
          <MetricCard
            title="Input Tokens"
            value={metrics.data.llmTokens.input.toLocaleString()}
            description="LLM input tokens"
          />
          <MetricCard
            title="Output Tokens"
            value={metrics.data.llmTokens.output.toLocaleString()}
            description="LLM output tokens"
          />
          <MetricCard
            title="Total Tokens"
            value={metrics.data.llmTokens.total.toLocaleString()}
            description="Combined token usage"
          />
        </>
      )}

      {metrics.data.toolInvocations !== undefined && (
        <MetricCard
          title="Tool Invocations"
          value={metrics.data.toolInvocations}
          description="Total tool calls"
        />
      )}

      {metrics.data.goalStats && (
        <>
          <MetricCard
            title="Goals Created"
            value={metrics.data.goalStats.created}
            description="New goals"
          />
          <MetricCard
            title="Goals Completed"
            value={metrics.data.goalStats.completed}
            description="Successfully finished"
          />
          <MetricCard
            title="Goals Failed"
            value={metrics.data.goalStats.failed}
            description="Failed goals"
          />
        </>
      )}
    </div>
  );
}
