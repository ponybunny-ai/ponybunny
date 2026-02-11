'use client';

import { useState, useEffect } from 'react';
import { 
  Activity, 
  RefreshCw, 
  Server, 
  Cpu, 
  HardDrive, 
  Network, 
  Zap,
  Users,
  Clock,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import type { SystemStatusResponse } from '@/types/system-status';
import { formatBytes, formatUptime, formatPercentage, formatNumber, formatDuration } from '@/lib/format';

export default function StatusPage() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/system/status');
      const data = await response.json();

      if (response.ok && data) {
        setStatus(data);
        setLastUpdate(new Date());
      } else {
        console.error('Invalid response:', data);
        toast.error('Failed to fetch system status');
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
      toast.error('Failed to fetch system status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status: 'running' | 'stopped') => {
    if (status === 'running') {
      return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Running</Badge>;
    }
    return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Stopped</Badge>;
  };

  if (loading || !status) {
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

  const { system, processes, gateway, scheduler } = status;

  return (
    <div className="flex flex-col h-screen max-w-7xl mx-auto p-8 gap-8 overflow-hidden">
      <div className="flex-none space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
            <p className="text-muted-foreground mt-2">Real-time monitoring of PonyBunny system</p>
            {lastUpdate && (
              <p className="text-xs text-muted-foreground mt-1">
                Last updated: {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setRefreshing(true); fetchStatus(); }}
            disabled={refreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {system.hardware.cpu.usage !== undefined 
                  ? formatPercentage(system.hardware.cpu.usage)
                  : 'N/A'}
              </div>
              <p className="text-xs text-muted-foreground">
                {system.hardware.cpu.cores} cores @ {system.hardware.cpu.speed} MHz
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatPercentage(system.hardware.memory.usagePercent)}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatBytes(system.hardware.memory.used)} / {formatBytes(system.hardware.memory.total)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Connections</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{gateway.connections.total}</div>
              <p className="text-xs text-muted-foreground">
                {gateway.connections.authenticated} authenticated
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">System Uptime</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatUptime(system.os.uptime)}</div>
              <p className="text-xs text-muted-foreground">{system.os.hostname}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 space-y-4">
        <TabsList className="flex-none">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="processes">Processes</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="scheduler">Scheduler</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 min-h-0">
          <ScrollArea className="h-full pr-4">
            <div className="grid gap-4 md:grid-cols-2">
            <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    Operating System
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Platform</span>
                    <span className="text-sm font-medium">{system.os.platform}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <span className="text-sm font-medium">{system.os.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Release</span>
                    <span className="text-sm font-medium">{system.os.release}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Architecture</span>
                    <span className="text-sm font-medium">{system.os.arch}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Hostname</span>
                    <span className="text-sm font-medium">{system.os.hostname}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5" />
                    CPU Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Model</span>
                    <span className="text-sm font-medium">{system.hardware.cpu.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Cores</span>
                    <span className="text-sm font-medium">{system.hardware.cpu.cores}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Speed</span>
                    <span className="text-sm font-medium">{system.hardware.cpu.speed} MHz</span>
                  </div>
                  {system.hardware.cpu.usage !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Usage</span>
                      <span className="text-sm font-medium">
                        {formatPercentage(system.hardware.cpu.usage)}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HardDrive className="h-5 w-5" />
                    Memory Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-sm font-medium">
                      {formatBytes(system.hardware.memory.total)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Used</span>
                    <span className="text-sm font-medium">
                      {formatBytes(system.hardware.memory.used)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Free</span>
                    <span className="text-sm font-medium">
                      {formatBytes(system.hardware.memory.free)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Usage</span>
                    <span className="text-sm font-medium">
                      {formatPercentage(system.hardware.memory.usagePercent)}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Gateway Connections
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-sm font-medium">{gateway.connections.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Authenticated</span>
                    <span className="text-sm font-medium">{gateway.connections.authenticated}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Pending</span>
                    <span className="text-sm font-medium">{gateway.connections.pending}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Daemon</span>
                    {gateway.daemonConnected ? (
                      <Badge variant="outline" className="text-green-500">Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">Disconnected</Badge>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Scheduler</span>
                    {gateway.schedulerConnected ? (
                      <Badge variant="outline" className="text-green-500">Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500">Disconnected</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="processes" className="flex-1 min-h-0">
          <ScrollArea className="h-full pr-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Server className="h-5 w-5" />
                      Gateway Process
                    </CardTitle>
                    {getStatusBadge(processes.gateway.status)}
                  </div>
                  <CardDescription>WebSocket server process</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">PID</span>
                    <span className="text-sm font-medium">{processes.gateway.pid || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Uptime</span>
                    <span className="text-sm font-medium">
                      {processes.gateway.uptime > 0 ? formatUptime(processes.gateway.uptime) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Memory (RSS)</span>
                    <span className="text-sm font-medium">
                      {formatBytes(processes.gateway.memory.rss)}
                    </span>
                  </div>
                  {processes.gateway.socketPath && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Socket</span>
                      <span className="text-sm font-medium text-xs truncate max-w-[200px]">
                        {processes.gateway.socketPath}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="h-5 w-5" />
                      Scheduler Process
                    </CardTitle>
                    {getStatusBadge(processes.scheduler.status)}
                  </div>
                  <CardDescription>Task orchestration process</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">PID</span>
                    <span className="text-sm font-medium">{processes.scheduler.pid || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Uptime</span>
                    <span className="text-sm font-medium">
                      {processes.scheduler.uptime > 0 ? formatUptime(processes.scheduler.uptime) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Memory (RSS)</span>
                    <span className="text-sm font-medium">
                      {formatBytes(processes.scheduler.memory.rss)}
                    </span>
                  </div>
                  {processes.scheduler.mode && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Mode</span>
                      <Badge variant="outline">{processes.scheduler.mode}</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Current Process (Web UI)
                  </CardTitle>
                  <CardDescription>Next.js web interface process</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">PID</span>
                      <span className="text-sm font-medium">{processes.current.pid}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Uptime</span>
                      <span className="text-sm font-medium">{formatUptime(processes.current.uptime)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">RSS</span>
                      <span className="text-sm font-medium">{formatBytes(processes.current.memory.rss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Heap Used</span>
                      <span className="text-sm font-medium">{formatBytes(processes.current.memory.heapUsed)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Heap Total</span>
                      <span className="text-sm font-medium">{formatBytes(processes.current.memory.heapTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">External</span>
                      <span className="text-sm font-medium">{formatBytes(processes.current.memory.external)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="network" className="flex-1 min-h-0">
          <ScrollArea className="h-full pr-4">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Network className="h-5 w-5" />
                    Network Interfaces
                  </CardTitle>
                  <CardDescription>
                    {system.network.interfaces.length} interface(s) detected
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px] pr-4">
                    <div className="space-y-4">
                      {system.network.interfaces.map((iface, index) => (
                        <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{iface.name}</span>
                              <Badge variant="outline">{iface.family}</Badge>
                              {iface.internal && <Badge variant="secondary">Internal</Badge>}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {iface.address}
                              {iface.mac && ` • MAC: ${iface.mac}`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Connections by IP
                  </CardTitle>
                  <CardDescription>
                    Active connections grouped by IP address
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px] pr-4">
                    <div className="space-y-2">
                      {Object.entries(gateway.connections.byIp).length > 0 ? (
                        Object.entries(gateway.connections.byIp).map(([ip, count]) => (
                          <div key={ip} className="flex items-center justify-between p-2 border rounded">
                            <span className="text-sm font-mono">{ip}</span>
                            <Badge variant="outline">{count} connection(s)</Badge>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No active connections
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="scheduler" className="flex-1 min-h-0">
          <ScrollArea className="h-full pr-4">
            <div className="space-y-4">
          {scheduler.isConnected ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Status</CardTitle>
                    <Zap className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold capitalize">
                      {scheduler.state?.status || 'Unknown'}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {scheduler.state?.errorCount || 0} error(s)
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Goals</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {scheduler.state?.activeGoals.length || 0}
                    </div>
                    <p className="text-xs text-muted-foreground">Currently executing</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Goals Processed</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(scheduler.metrics?.goalsProcessed || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">Total completed</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Work Items</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(scheduler.metrics?.workItemsCompleted || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">Completed</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Scheduler State</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge variant="outline" className="capitalize">
                        {scheduler.state?.status || 'Unknown'}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Active Goals</span>
                      <span className="text-sm font-medium">
                        {scheduler.state?.activeGoals.length || 0}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Error Count</span>
                      <span className="text-sm font-medium">
                        {scheduler.state?.errorCount || 0}
                      </span>
                    </div>
                    {scheduler.state?.lastTickAt && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Last Tick</span>
                        <span className="text-sm font-medium">
                          {new Date(scheduler.state.lastTickAt).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Performance Metrics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Goals Processed</span>
                      <span className="text-sm font-medium">
                        {formatNumber(scheduler.metrics?.goalsProcessed || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Work Items Completed</span>
                      <span className="text-sm font-medium">
                        {formatNumber(scheduler.metrics?.workItemsCompleted || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Avg Completion Time</span>
                      <span className="text-sm font-medium">
                        {formatDuration(scheduler.metrics?.averageCompletionTime || 0)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {scheduler.state?.activeGoals && scheduler.state.activeGoals.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Active Goals</CardTitle>
                    <CardDescription>Currently executing goals</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[200px] pr-4">
                      <div className="space-y-2">
                        {scheduler.state.activeGoals.map((goalId) => (
                          <div key={goalId} className="flex items-center justify-between p-2 border rounded">
                            <span className="text-sm font-mono">{goalId}</span>
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-500">
                              Running
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {scheduler.capabilities && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Capabilities Summary</CardTitle>
                      <CardDescription>Loaded models, providers, tools, MCPs, and skills</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 md:grid-cols-5">
                        <div className="text-center">
                          <div className="text-2xl font-bold">{scheduler.capabilities.summary.totalModels}</div>
                          <div className="text-xs text-muted-foreground">Models</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{scheduler.capabilities.summary.totalProviders}</div>
                          <div className="text-xs text-muted-foreground">Providers</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{scheduler.capabilities.summary.totalTools}</div>
                          <div className="text-xs text-muted-foreground">Tools</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{scheduler.capabilities.summary.totalMCPServers}</div>
                          <div className="text-xs text-muted-foreground">MCP Servers</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{scheduler.capabilities.summary.totalSkills}</div>
                          <div className="text-xs text-muted-foreground">Skills</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle>Models ({scheduler.capabilities.models.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[300px] pr-4">
                            <div className="space-y-2">
                              {scheduler.capabilities.models.map((model) => (
                                <div key={model.name} className="p-2 border rounded">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{model.displayName}</span>
                                    <Badge variant="outline" className="text-xs">{model.name}</Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {model.maxContextTokens.toLocaleString()} tokens • 
                                    ${model.costPer1kTokens.input}/${model.costPer1kTokens.output} per 1K
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Providers ({scheduler.capabilities.providers.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[300px] pr-4">
                            <div className="space-y-2">
                              {scheduler.capabilities.providers.map((provider) => (
                                <div key={provider.name} className="p-2 border rounded">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{provider.name}</span>
                                    <Badge variant={provider.enabled ? "outline" : "secondary"}>
                                      {provider.enabled ? 'Enabled' : 'Disabled'}
                                    </Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {provider.protocol} • Priority: {provider.priority}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Tools ({scheduler.capabilities.tools.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[300px] pr-4">
                            <div className="space-y-2">
                              {scheduler.capabilities.tools.map((tool) => (
                                <div key={tool.name} className="p-2 border rounded">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{tool.name}</span>
                                    <Badge variant={
                                      tool.riskLevel === 'safe' ? 'outline' : 
                                      tool.riskLevel === 'moderate' ? 'secondary' : 
                                      'destructive'
                                    }>
                                      {tool.riskLevel}
                                    </Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {tool.category} {tool.requiresApproval && '• Requires approval'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>MCP Servers ({scheduler.capabilities.mcpServers.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-[300px] pr-4">
                            <div className="space-y-2">
                              {scheduler.capabilities.mcpServers.map((server) => (
                                <div key={server.name} className="p-2 border rounded">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{server.name}</span>
                                    <Badge variant={server.enabled ? "outline" : "secondary"}>
                                      {server.enabled ? 'Enabled' : 'Disabled'}
                                    </Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {server.transport} • {server.allowedTools.length} tool(s)
                                  </div>
                                </div>
                              ))}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                  </div>

                  {scheduler.capabilities.skills.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Skills ({scheduler.capabilities.skills.length})</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-[400px] pr-4">
                          <div className="grid gap-2 md:grid-cols-2">
                            {scheduler.capabilities.skills.map((skill) => (
                              <div key={skill.name} className="p-2 border rounded">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">{skill.name}</span>
                                  {skill.version && (
                                    <Badge variant="outline" className="text-xs">{skill.version}</Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {skill.source}
                                </div>
                                {skill.tags && skill.tags.length > 0 && (
                                  <div className="flex gap-1 mt-1 flex-wrap">
                                    {skill.tags.map((tag) => (
                                      <Badge key={tag} variant="secondary" className="text-xs">
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-lg font-medium">Scheduler Not Connected</p>
                <p className="text-sm mt-2">The scheduler is not currently connected to the gateway</p>
              </CardContent>
            </Card>
          )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
