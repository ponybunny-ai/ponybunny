/**
 * WebGatewayClient - Browser WebSocket client for Gateway server
 */

import type {
  RequestFrame,
  Frame,
  Goal,
  WorkItem,
  Escalation,
  GoalSubmitParams,
} from './types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface WebGatewayClientOptions {
  url: string;
  token?: string;  // Optional - local connections don't need token
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onEvent?: (event: string, data: unknown) => void;
  onError?: (error: Error) => void;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

const DEFAULT_OPTIONS = {
  reconnect: true,
  reconnectIntervalMs: 2000,
  maxReconnectAttempts: 10,
};

export class WebGatewayClient {
  private ws: WebSocket | null = null;
  private options: WebGatewayClientOptions & typeof DEFAULT_OPTIONS;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private _authenticated = false;

  constructor(options: WebGatewayClientOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get authenticated(): boolean {
    return this._authenticated;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.closed || this.ws) {
      return;
    }

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.authenticate();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        const reason = event.reason || `code ${event.code}`;
        this.ws = null;
        this._authenticated = false;
        this.options.onDisconnect?.(reason);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.options.onError?.(new Error('WebSocket error'));
      };
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.flushPending(new Error('Client disconnected'));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async authenticate(): Promise<void> {
    try {
      // If token is provided, use token authentication
      if (this.options.token) {
        await this.request('auth.token', { token: this.options.token });
        this._authenticated = true;
        this.options.onConnect?.();
        return;
      }

      // For local connections, Gateway auto-authenticates
      // Just verify we can make requests
      await this.request('system.ping');
      this._authenticated = true;
      this.options.onConnect?.();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = crypto.randomUUID();
    const frame: RequestFrame = {
      type: 'req',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  private handleMessage(raw: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }

    if (frame.type === 'res') {
      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        this.pendingRequests.delete(frame.id);
        clearTimeout(pending.timeoutId);

        if (frame.error) {
          pending.reject(new Error(frame.error.message));
        } else {
          pending.resolve(frame.result);
        }
      }
    } else if (frame.type === 'event') {
      // Call global event handler
      this.options.onEvent?.(frame.event, frame.data);

      // Call specific event handlers
      const handlers = this.eventHandlers.get(frame.event);
      if (handlers) {
        handlers.forEach((handler) => handler(frame.data));
      }

      // Also call wildcard handlers
      const wildcardHandlers = this.eventHandlers.get('*');
      if (wildcardHandlers) {
        wildcardHandlers.forEach((handler) => handler({ event: frame.event, data: frame.data }));
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || !this.options.reconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.options.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.ws = null;
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
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  async submitGoal(params: GoalSubmitParams): Promise<Goal> {
    return this.request<Goal>('goal.submit', params);
  }

  async listGoals(params?: { status?: string; limit?: number; offset?: number }): Promise<{ goals: Goal[]; total: number }> {
    return this.request<{ goals: Goal[]; total: number }>('goal.list', params);
  }

  async getGoal(goalId: string): Promise<Goal> {
    return this.request<Goal>('goal.get', { goalId });
  }

  async cancelGoal(goalId: string): Promise<void> {
    return this.request<void>('goal.cancel', { goalId });
  }

  async subscribeToGoal(goalId: string): Promise<void> {
    return this.request<void>('subscribe', { goalId });
  }

  async unsubscribeFromGoal(goalId: string): Promise<void> {
    return this.request<void>('unsubscribe', { goalId });
  }

  async getWorkItemsByGoal(goalId: string): Promise<{ workItems: WorkItem[] }> {
    return this.request<{ workItems: WorkItem[] }>('workitem.list', { goalId });
  }

  async getEscalations(params?: { goalId?: string; status?: string }): Promise<{ escalations: Escalation[] }> {
    return this.request<{ escalations: Escalation[] }>('escalation.list', params);
  }

  async respondToEscalation(
    escalationId: string,
    action: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    return this.request<void>('escalation.respond', { escalationId, action, data });
  }

  async ping(): Promise<{ pong: boolean }> {
    return this.request<{ pong: boolean }>('ping');
  }
}

// Singleton instance for easy access
let clientInstance: WebGatewayClient | null = null;

export function getGatewayClient(): WebGatewayClient | null {
  return clientInstance;
}

export function setGatewayClient(client: WebGatewayClient | null): void {
  clientInstance = client;
}
