'use client';

import { useDebug } from '@/components/providers/debug-provider';
import { cn } from '@/lib/utils';

export function ConnectionStatus() {
  const { state } = useDebug();

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            state.connected ? 'bg-green-500' : 'bg-red-500'
          )}
        />
        <span className="text-sm text-muted-foreground">
          WebSocket: {state.connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            state.gatewayConnected ? 'bg-green-500' : 'bg-yellow-500'
          )}
        />
        <span className="text-sm text-muted-foreground">
          Gateway: {state.gatewayConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
}
