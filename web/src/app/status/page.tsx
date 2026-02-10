'use client';

import { useState, useEffect } from 'react';
import { Activity, Power, RefreshCw, Play, Square } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ServiceStatus {
  name: string;
  status: string;
  pid: string | null;
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/system/status');
      const data = await response.json();
      if (data.services) {
        setServices(data.services);
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
        fetchStatus();
      } else {
        toast.error(`Failed to ${action} ${service}: ${data.error}`);
      }
    } catch (error) {
      console.error(`Failed to ${action} ${service}:`, error);
      toast.error(`Failed to ${action} ${service}`);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'text-green-500';
      case 'stopped':
        return 'text-red-500';
      default:
        return 'text-yellow-500';
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Status</h1>
          <p className="text-muted-foreground mt-2">Monitor and control PonyBunny services</p>
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

      <div className="grid gap-6 md:grid-cols-2">
        {/* Global Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
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
        {services.map((service) => (
          <Card key={service.name}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="capitalize">{service.name}</CardTitle>
                <div className={`flex items-center gap-2 text-sm font-medium ${getStatusColor(service.status)}`}>
                  <div className={`h-2 w-2 rounded-full bg-current`} />
                  {service.status.toUpperCase()}
                </div>
              </div>
              <CardDescription>PID: {service.pid || 'N/A'}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 justify-end">
                {service.status === 'running' ? (
                  <>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleControl(service.name, 'restart')}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      onClick={() => handleControl(service.name, 'stop')}
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <Button 
                    size="sm" 
                    onClick={() => handleControl(service.name, 'start')}
                  >
                    <Play className="h-4 w-4" /> Start
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        
        {services.length === 0 && !loading && (
          <Card className="col-span-2 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="h-12 w-12 mb-4 opacity-20" />
              <p>No services detected. Is the CLI installed?</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
