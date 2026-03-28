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
  DollarSign,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

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
    </div>
  );
}
