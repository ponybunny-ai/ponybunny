/**
 * Gateway Client - Connects to PonyBunny Gateway and subscribes to debug events.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import type { DebugEvent } from './types.js';

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

interface RpcRequest {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

interface RpcResponse {
  type: 'res';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface DebugEventMessage {
  type: 'event';
  event: 'debug';
  data: {
    channel: 'debug';
    event: DebugEvent;
    timestamp: number;
  };
}

type GatewayMessage = RpcResponse | DebugEventMessage;

export interface GatewayClientOptions {
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  requestTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<GatewayClientOptions> = {
  reconnect: true,
  reconnectIntervalMs: 3000,
  requestTimeoutMs: 30000,
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private gatewayUrl: string = '';
  private adminToken: string = '';
  private options: Required<GatewayClientOptions>;

  private pending = new Map<string, PendingRequest>();
  private authenticated = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = false;

  private eventHandler: ((event: DebugEvent) => void) | null = null;
  private connectionChangeHandler: ((connected: boolean) => void) | null = null;

  constructor(options: GatewayClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Connect to Gateway using admin token.
   */
  async connect(gatewayUrl: string, adminToken: string): Promise<void> {
    this.gatewayUrl = gatewayUrl;
    this.adminToken = adminToken;
    this.shouldReconnect = this.options.reconnect;

    return this.doConnect();
  }

  /**
   * Disconnect from Gateway.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.authenticated = false;
    this.clearPendingRequests();
  }

  /**
   * Check if connected and authenticated.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authenticated;
  }

  /**
   * Register handler for debug events.
   */
  onEvent(handler: (event: DebugEvent) => void): void {
    this.eventHandler = handler;
  }

  /**
   * Register handler for connection state changes.
   */
  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionChangeHandler = handler;
  }

  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.gatewayUrl);

        this.ws.on('open', async () => {
          console.log('[GatewayClient] Connected to Gateway');
          try {
            await this.authenticate();
            await this.subscribeToDebugEvents();
            this.notifyConnectionChange(true);
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[GatewayClient] Disconnected: ${code} ${reason.toString()}`);
          this.authenticated = false;
          this.notifyConnectionChange(false);
          this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[GatewayClient] WebSocket error:', error);
          if (!this.authenticated) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async authenticate(): Promise<void> {
    // Use direct token authentication (auth.token) for admin tokens
    const result = await this.rpcCall<{ success: boolean; sessionId?: string; permissions?: string[]; error?: string }>('auth.token', {
      token: this.adminToken,
    });

    if (!result.success) {
      throw new Error(`Authentication failed: ${result.error || 'Unknown error'}`);
    }

    this.authenticated = true;
    console.log('[GatewayClient] Authenticated with Gateway (session:', result.sessionId, ')');
  }

  private async subscribeToDebugEvents(): Promise<void> {
    await this.rpcCall('debug.events.subscribe', {});
    console.log('[GatewayClient] Subscribed to debug events');
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as GatewayMessage;

      if (message.type === 'res') {
        this.handleResponse(message);
      } else if (message.type === 'event' && message.event === 'debug') {
        this.handleDebugEvent(message);
      }
    } catch (error) {
      console.error('[GatewayClient] Failed to parse message:', error);
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timeoutId);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleDebugEvent(message: DebugEventMessage): void {
    if (this.eventHandler && message.data?.event) {
      this.eventHandler(message.data.event);
    }
  }

  private async rpcCall<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Gateway');
    }

    const id = randomUUID();
    const request: RpcRequest = {
      type: 'req',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.options.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeoutId,
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(async () => {
      console.log('[GatewayClient] Attempting to reconnect...');
      try {
        await this.doConnect();
      } catch (error) {
        console.error('[GatewayClient] Reconnection failed:', error);
        this.scheduleReconnect();
      }
    }, this.options.reconnectIntervalMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPendingRequests(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }

  private notifyConnectionChange(connected: boolean): void {
    if (this.connectionChangeHandler) {
      this.connectionChangeHandler(connected);
    }
  }
}
