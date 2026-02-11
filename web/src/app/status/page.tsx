'use client';

import { useState, useEffect } from 'react';
import { Activity, Power, RefreshCw, Play, Square, Server, Database, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface ServiceStatus {
  name: string;
  status: string;
  pid: string | null;
  uptime?: string;
  memory?: string;
}

interface SystemMetrics {
  totalServices: number;
  runningServices: number;
  stoppedServices: number;
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/system/status');
      const data = await response.json();

      if (response.ok && data.services) {
        setServices(data.services);
        setLastUpdate(new Date());
      } else {
        console.error('Invalid response:', data);
        if (!data.services) {
          toast.error('No service data received');
        }
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

  const handleControl = async (service: string, action: string) => {
    try {
      toast.info(`${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting'} ${service}...`);
      const response = await fetch('/api/system/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, action }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(`Successfully ${action}ed ${service}`);
        setTimeout(fetchStatus, 1000); // Refresh after 1 second
      } else {
        toast.error(`Failed to ${action} ${service}: ${data.error}`);
      }
    } catch (error) {
      console.error(`Failed to ${action} ${service}:`, error);
      toast.error(`Failed to ${action} ${service}`);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return <Badge className="bg-green-500">Running</Badge>;
      case 'stopped':
        return <Badge variant="destructive">Stopped</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getServiceIcon = (name: string) => {
    switch (name.toLowerCase()) {
      case 'gateway':
        return <Server className="h-5 w-5" />;
      case 'scheduler':
        return <Zap className="h-5 w-5" />;
      default:
        return <Database className="h-5 w-5" />;
    }
  };

  const metrics: SystemMetrics = {
    totalServices: services.length,
    runningServices: services.filter(s => s.status.toLowerCase() === 'running').length,
    stoppedServices: services.filter(s => s.status.toLowerCase() === 'stopped').length,
  };

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
          <p className="text-muted-foreground mt-2">Monitor and control PonyBunny services</p>
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

      {/* System Metrics Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Services</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalServices}</div>
            <p className="text-xs text-muted-foreground">Registered services</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running</CardTitle>
            <Play className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{metrics.runningServices}</div>
            <p className="text-xs text-muted-foreground">Active services</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stopped</CardTitle>
            <Square className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{metrics.stoppedServices}</div>
            <p className="text-xs text-muted-foreground">Inactive services</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Global Controls */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="h-5 w-5" />
              Global Controls
            </CardTitle>
            <CardDescription>Manage all services at once</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-4">
            <Button onClick={() => handleControl('all', 'start')} className="flex-1">
              <Play className="mr-2 h-4 w-4" /> Start All
            </Button>
            <Button onClick={() => handleControl('all', 'stop')} variant="destructive" className="flex-1">
              <Square className="mr-2 h-4 w-4" /> Stop All
            </Button>
            <Button onClick={() => handleControl('all', 'restart')} variant="outline" className="flex-1">
              <RefreshCw className="mr-2 h-4 w-4" /> Restart All
            </Button>
          </CardContent>
        </Card>

        {/* Service List */}
        {loading ? (
          <Card className="md:col-span-2">
            <CardContent className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : services.length > 0 ? (
          services.map((service) => (
            <Card key={service.name} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getServiceIcon(service.name)}
                    <div>
                      <CardTitle className="capitalize">{service.name}</CardTitle>
                      <CardDescription className="mt-1">
                        PID: {service.pid || 'N/A'}
                        {service.uptime && ` • Uptime: ${service.uptime}`}
                      </CardDescription>
                    </div>
                  </div>
                  {getStatusBadge(service.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 justify-end">
                  {service.status.toLowerCase() === 'running' ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleControl(service.name, 'restart')}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Restart
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleControl(service.name, 'stop')}
                      >
                        <Square className="mr-2 h-4 w-4" />
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleControl(service.name, 'start')}
                      className="w-full"
                    >
                      <Play className="mr-2 h-4 w-4" /> Start Service
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="md:col-span-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-lg font-medium">No services detected</p>
              <p className="text-sm mt-2">Make sure the PonyBunny CLI is installed and configured</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
