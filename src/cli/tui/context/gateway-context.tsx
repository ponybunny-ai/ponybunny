/**
 * Gateway Context - Manages Gateway connection state
 */

import * as React from 'react';
import { createContext, useContext, useRef, useEffect, useCallback } from 'react';
import { TuiGatewayClient, type GatewayEvent as ClientGatewayEvent } from '../../gateway/index.js';
import type { ConnectionStatus } from '../store/types.js';

export interface GatewayContextValue {
  client: TuiGatewayClient | null;
  connectionStatus: ConnectionStatus;
  url: string;
  connect: () => void;
  disconnect: () => void;
}

const GatewayContext = createContext<GatewayContextValue | null>(null);

export interface GatewayProviderProps {
  url?: string;
  token?: string;
  children: React.ReactNode;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onEvent?: (event: ClientGatewayEvent) => void;
  onError?: (error: Error) => void;
}

export const GatewayProvider: React.FC<GatewayProviderProps> = ({
  url = 'ws://127.0.0.1:18789',
  token,
  children,
  onConnected,
  onDisconnected,
  onEvent,
  onError,
}) => {
  const clientRef = useRef<TuiGatewayClient | null>(null);
  const [connectionStatus, setConnectionStatus] = React.useState<ConnectionStatus>('connecting');

  // Store callbacks in refs to avoid recreating connect/disconnect
  const callbacksRef = useRef({ onConnected, onDisconnected, onEvent, onError });
  callbacksRef.current = { onConnected, onDisconnected, onEvent, onError };

  const connect = useCallback(() => {
    if (clientRef.current) {
      return;
    }

    const client = new TuiGatewayClient({ url, token });
    clientRef.current = client;

    client.onConnected = () => {
      setConnectionStatus('connected');
      callbacksRef.current.onConnected?.();
    };

    client.onDisconnected = (reason) => {
      setConnectionStatus('disconnected');
      callbacksRef.current.onDisconnected?.(reason);
    };

    client.onEvent = (evt) => {
      callbacksRef.current.onEvent?.(evt);
    };

    client.onError = (error) => {
      setConnectionStatus('error');
      callbacksRef.current.onError?.(error);
    };

    client.start();
  }, [url, token]);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stop();
      clientRef.current = null;
      setConnectionStatus('disconnected');
    }
  }, []);

  // Connect on mount, disconnect on unmount
  // Only reconnect if url or token changes
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  const value: GatewayContextValue = {
    client: clientRef.current,
    connectionStatus,
    url,
    connect,
    disconnect,
  };

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
};

export function useGatewayContext(): GatewayContextValue {
  const context = useContext(GatewayContext);
  if (!context) {
    throw new Error('useGatewayContext must be used within a GatewayProvider');
  }
  return context;
}
