/**
 * Server-side Gateway Connection Manager
 * Maintains a singleton WebSocket connection to the Gateway
 */

import type {
  RequestFrame,
  Frame,
  Goal,
  WorkItem,
  Escalation,
  GoalSubmitParams,
} from '../types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

type EventHandler = (event: string, data: unknown) => void;

class GatewayConnection {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectIntervalMs = 2000;
  private url: string;
  private _connected = false;

  constructor(url: string = 'ws://127.0.0.1:18789') {
    this.url = url;
  }

  get connected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[GatewayConnection] Connected to Gateway');
          this._connected = true;
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };

        this.ws.onclose = (event) => {
          console.log(`[GatewayConnection] Disconnected: ${event.code} ${event.reason}`);
          this._connected = false;
          this.ws = null;
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[GatewayConnection] WebSocket error:', error);
          if (!this._connected) {
            reject(new Error('Failed to connect to Gateway'));
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
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
      this.eventHandlers.forEach((handler) => {
        handler(frame.event, frame.data);
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[GatewayConnection] Max reconnect attempts reached');
      return;
    }

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`[GatewayConnection] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect().catch(console.error);
    }, this.reconnectIntervalMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Try to connect first
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to Gateway');
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

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
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
    return this.request<{ pong: boolean }>('system.ping');
  }
}

// Singleton instance
let instance: GatewayConnection | null = null;

export function getGatewayConnection(): GatewayConnection {
  if (!instance) {
    const url = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
    instance = new GatewayConnection(url);
  }
  return instance;
}

export function resetGatewayConnection(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}
