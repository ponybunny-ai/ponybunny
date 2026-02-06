'use client';

import { Badge } from '@/components/ui/badge';
import { useGateway } from '@/components/providers/gateway-provider';

export function ConnectionStatus() {
  const { state } = useGateway();

  if (state.connecting) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
        Connecting
      </Badge>
    );
  }

  if (state.connected) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        Connected
      </Badge>
    );
  }

  if (state.error) {
    return (
      <Badge variant="destructive" className="gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        Error
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="h-2 w-2 rounded-full bg-gray-400" />
      Disconnected
    </Badge>
  );
}
