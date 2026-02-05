/**
 * Gateway Client - WebSocket client for connecting to the Gateway server
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { getPublicKey, signChallenge, hasKeyPair } from '../lib/key-manager.js';

export interface GatewayClientOptions {
  url?: string;
  token?: string;  // Pairing token for first-time setup
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface EventFrame {
  type: 'event';
  event: string;
  data: unknown;
}

type Frame = RequestFrame | ResponseFrame | EventFrame;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

const DEFAULT_OPTIONS: Required<GatewayClientOptions> = {
  url: 'ws://127.0.0.1:18789',
  token: '',
  reconnect: true,
  reconnectIntervalMs: 2000,
  maxReconnectAttempts: 10,
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private options: Required<GatewayClientOptions>;
  private pending = new Map<string, PendingRequest>();
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private authenticated = false;

  // Event callbacks
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onEvent?: (event: string, data: unknown) => void;
  onError?: (error: Error) => void;
  onAuthRequired?: () => Promise<{ publicKey: string; signature: string }>;

  readonly url: string;

  constructor(options: GatewayClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.url = this.options.url;
  }

  /**
   * Start the client and connect to the gateway
   */
  start(): void {
    if (this.closed) {
      return;
    }
    this.connect();
  }

  /**
   * Stop the client and close the connection
   */
  stop(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.flushPending(new Error('Client stopped'));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  /**
   * Send an RPC request to the gateway
   */
  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = randomUUID();
    const frame: RequestFrame = {
      type: 'req',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  private connect(): void {
    if (this.ws) {
      return;
    }

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.authenticate();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason.toString() || `code ${code}`;
        this.ws = null;
        this.authenticated = false;
        this.onDisconnected?.(reasonStr);
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.onError?.(error);
      });
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  private async authenticate(): Promise<void> {
    try {
      // If a pairing token is provided, use it to pair this client
      if (this.options.token) {
        // Start pairing flow
        const pairResult = await this.request<{ challenge: string }>('auth.pair', {
          token: this.options.token
        });

        // Sign the challenge and verify with our public key
        const publicKey = getPublicKey();
        const signature = signChallenge(pairResult.challenge);

        await this.request('auth.verify', { signature, publicKey });
        this.authenticated = true;
        this.onConnected?.();
        return;
      }

      // Check if we have a keypair for authentication
      if (hasKeyPair()) {
        try {
          // Try to authenticate with existing keypair
          const publicKey = getPublicKey();
          const helloResult = await this.request<{ challenge: string }>('auth.hello', { publicKey });

          // Sign the challenge
          const signature = signChallenge(helloResult.challenge);

          await this.request('auth.verify', { signature });
          this.authenticated = true;
          this.onConnected?.();
          return;
        } catch (error) {
          // If auth.hello fails (unknown public key), we need to pair first
          const errorMsg = error instanceof Error ? error.message : String(error);
          if (errorMsg.includes('Unknown public key') || errorMsg.includes('auth.pair')) {
            // Need to pair - notify via error callback
            this.onError?.(new Error('Client not paired. Run `pb gateway pair` to create a pairing token, then connect with --token <token>'));
            return;
          }
          throw error;
        }
      }

      // No keypair and no token - cannot authenticate
      this.onError?.(new Error('No authentication credentials. Run `pb gateway pair` to create a pairing token, then connect with --token <token>'));
    } catch (error) {
      // Auth failed
      this.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleMessage(raw: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }

    if (frame.type === 'res') {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }

        if (frame.error) {
          pending.reject(new Error(frame.error.message));
        } else {
          pending.resolve(frame.result);
        }
      }
    } else if (frame.type === 'event') {
      this.onEvent?.(frame.event, frame.data);
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.options.reconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, this.options.reconnectIntervalMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private flushPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}
