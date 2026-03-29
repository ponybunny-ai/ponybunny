'use client';

import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Target,
  ListChecks,
  Zap,
  AlertTriangle,
  TrendingUp,
  ShieldCheck,
  Bug,
  BarChart3,
  Calendar,
  BookOpen,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface ErrorCluster {
  error_signature: string;
  count: number;
  most_recent: number;
  affected_goals: number;
}

interface ItemTypeFailureRate {
  item_type: string;
  total_runs: number;
  failed_runs: number;
  failure_rate: number;
}

interface GoalTimelineEntry {
  date: string;
  completed: number;
  failed: number;
}

interface EvaluationDistribution {
  total_reports: number;
  total_publish: number;
  total_retry: number;
  total_replan: number;
  total_escalate: number;
  total_skipped: number;
}

interface KnowledgeStats {
  total_entries: number;
  by_type: Record<string, number>;
  avg_confidence: number;
  recently_reinforced: number;
}

interface DashboardData {
  scheduler: {
    totalGoalsProcessed: number;
    totalWorkItemsCompleted: number;
    totalRunsExecuted: number;
    averageWorkItemDurationMs: number;
    successRate: number;
    currentActiveGoals: number;
    currentActiveWorkItems: number;
  } | null;
  audit: {
    total: number;
    by_action: Record<string, number>;
    by_entity_type: Record<string, number>;
  } | null;
  errorClusters: ErrorCluster[] | null;
  failureRates: ItemTypeFailureRate[] | null;
  timeline: GoalTimelineEntry[] | null;
  evaluationDistribution: EvaluationDistribution | null;
  knowledgeStats: KnowledgeStats | null;
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'good' | 'warning' | 'bad';
}) {
  const trendColor = trend === 'good'
    ? 'text-green-500'
    : trend === 'bad'
      ? 'text-red-500'
      : trend === 'warning'
        ? 'text-yellow-500'
        : 'text-muted-foreground';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${trendColor}`}>{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const response = await fetch('/api/dashboard');
      const result = await response.json();
      if (response.ok) {
        setData(result);
      } else {
        toast.error('Failed to fetch dashboard data');
      }
    } catch {
      toast.error('Failed to connect to gateway');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const scheduler = data?.scheduler;
  const audit = data?.audit;
  const successRate = scheduler?.successRate ?? 0;
  const successTrend = successRate >= 80 ? 'good' : successRate >= 50 ? 'warning' : 'bad';
  const avgDuration = scheduler?.averageWorkItemDurationMs
    ? `${(scheduler.averageWorkItemDurationMs / 1000).toFixed(1)}s`
    : 'N/A';

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Harness Dashboard</h1>
          <p className="text-muted-foreground">Cross-goal metrics and harness health overview</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setRefreshing(true); fetchData(); }}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Top-level metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Goals Processed"
          value={scheduler?.totalGoalsProcessed ?? 0}
          subtitle={`${scheduler?.currentActiveGoals ?? 0} currently active`}
          icon={Target}
        />
        <MetricCard
          title="Work Items Completed"
          value={scheduler?.totalWorkItemsCompleted ?? 0}
          subtitle={`${scheduler?.currentActiveWorkItems ?? 0} in progress`}
          icon={ListChecks}
        />
        <MetricCard
          title="Success Rate"
          value={`${(successRate * 100).toFixed(1)}%`}
          subtitle={`${scheduler?.totalRunsExecuted ?? 0} total runs`}
          icon={TrendingUp}
          trend={successTrend}
        />
        <MetricCard
          title="Avg Work Item Duration"
          value={avgDuration}
          icon={Zap}
        />
      </div>

      {/* Harness metrics cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Error Clusters"
          value={data?.errorClusters?.length ?? 0}
          subtitle="Distinct error signatures"
          icon={Bug}
          trend={
            (data?.errorClusters?.length ?? 0) === 0
              ? 'good'
              : (data?.errorClusters?.length ?? 0) > 5
                ? 'bad'
                : 'warning'
          }
        />
        <MetricCard
          title="Evaluation Reports"
          value={data?.evaluationDistribution?.total_reports ?? 0}
          subtitle={`${data?.evaluationDistribution?.total_publish ?? 0} published`}
          icon={Activity}
        />
        <MetricCard
          title="Knowledge Entries"
          value={data?.knowledgeStats?.total_entries ?? 0}
          subtitle={`Avg confidence: ${((data?.knowledgeStats?.avg_confidence ?? 0) * 100).toFixed(0)}%`}
          icon={BookOpen}
        />
        <MetricCard
          title="Recently Reinforced"
          value={data?.knowledgeStats?.recently_reinforced ?? 0}
          subtitle="Knowledge entries reinforced recently"
          icon={TrendingUp}
        />
      </div>

      {/* Audit and activity section */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Audit Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {audit ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total audit events</span>
                  <span className="text-lg font-semibold">{audit.total.toLocaleString()}</span>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">By Action</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(audit.by_action).slice(0, 8).map(([action, count]) => (
                      <Badge key={action} variant="outline">
                        {action}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">By Entity Type</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(audit.by_entity_type).slice(0, 8).map(([type, count]) => (
                      <Badge key={type} variant="secondary">
                        {type}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No audit data available. Ensure the gateway is running.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Harness Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Gateway</span>
                <Badge className={data ? 'bg-green-500' : 'bg-red-500'}>
                  {data ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Scheduler</span>
                <Badge className={scheduler ? 'bg-green-500' : 'bg-yellow-500'}>
                  {scheduler ? 'Reporting' : 'No data'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Goals</span>
                <span className="text-lg font-semibold">{scheduler?.currentActiveGoals ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Active Work Items</span>
                <span className="text-lg font-semibold">{scheduler?.currentActiveWorkItems ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Error Signature Clusters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            Error Signature Clusters
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data?.errorClusters && data.errorClusters.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Signature</th>
                    <th className="text-right py-2 px-4 font-medium text-muted-foreground">Count</th>
                    <th className="text-right py-2 px-4 font-medium text-muted-foreground">Affected Goals</th>
                    <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Most Recent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errorClusters.map((cluster) => (
                    <tr key={cluster.error_signature} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs max-w-md truncate" title={cluster.error_signature}>
                        {cluster.error_signature}
                      </td>
                      <td className="text-right py-2 px-4">
                        <Badge variant={cluster.count > 5 ? 'destructive' : 'outline'}>{cluster.count}</Badge>
                      </td>
                      <td className="text-right py-2 px-4">{cluster.affected_goals}</td>
                      <td className="text-right py-2 pl-4 text-muted-foreground">
                        {new Date(cluster.most_recent).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No error clusters recorded.</p>
          )}
        </CardContent>
      </Card>

      {/* Work Item Failure Rates + Evaluation Distribution */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Work Item Failure Rates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.failureRates && data.failureRates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Item Type</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Total</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Failed</th>
                      <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failureRates.map((rate) => (
                      <tr key={rate.item_type} className="border-b last:border-0">
                        <td className="py-2 pr-4">{rate.item_type}</td>
                        <td className="text-right py-2 px-4">{rate.total_runs}</td>
                        <td className="text-right py-2 px-4">{rate.failed_runs}</td>
                        <td className="text-right py-2 pl-4">
                          <Badge
                            variant={rate.failure_rate > 0.5 ? 'destructive' : rate.failure_rate > 0.2 ? 'outline' : 'secondary'}
                          >
                            {(rate.failure_rate * 100).toFixed(1)}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No failure rate data available.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Evaluation Decision Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.evaluationDistribution ? (
              <div className="space-y-3">
                {[
                  { label: 'Publish', value: data.evaluationDistribution.total_publish, color: 'bg-green-500' },
                  { label: 'Retry', value: data.evaluationDistribution.total_retry, color: 'bg-yellow-500' },
                  { label: 'Replan', value: data.evaluationDistribution.total_replan, color: 'bg-orange-500' },
                  { label: 'Escalate', value: data.evaluationDistribution.total_escalate, color: 'bg-red-500' },
                  { label: 'Skipped', value: data.evaluationDistribution.total_skipped, color: 'bg-gray-400' },
                ].map(({ label, value, color }) => {
                  const total = data.evaluationDistribution!.total_reports || 1;
                  const pct = ((value / total) * 100).toFixed(1);
                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{label}</span>
                        <span className="text-muted-foreground">{value} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${color}`}
                          style={{ width: `${Math.min(parseFloat(pct), 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No evaluation data available.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Goal Timeline + Knowledge Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Goal Timeline (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.timeline && data.timeline.length > 0 ? (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Completed</th>
                      <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.timeline.map((entry) => (
                      <tr key={entry.date} className="border-b last:border-0">
                        <td className="py-2 pr-4">{entry.date}</td>
                        <td className="text-right py-2 px-4">
                          <span className="text-green-600 font-medium">{entry.completed}</span>
                        </td>
                        <td className="text-right py-2 pl-4">
                          <span className={entry.failed > 0 ? 'text-red-500 font-medium' : 'text-muted-foreground'}>
                            {entry.failed}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No timeline data available.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Knowledge Store
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.knowledgeStats ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Entries</p>
                    <p className="text-2xl font-bold">{data.knowledgeStats.total_entries}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Confidence</p>
                    <p className="text-2xl font-bold">{(data.knowledgeStats.avg_confidence * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Recently Reinforced</p>
                  <p className="text-lg font-semibold">{data.knowledgeStats.recently_reinforced}</p>
                </div>
                {Object.keys(data.knowledgeStats.by_type).length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">By Type</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(data.knowledgeStats.by_type).map(([type, count]) => (
                        <Badge key={type} variant="secondary">
                          {type}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No knowledge data available.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
