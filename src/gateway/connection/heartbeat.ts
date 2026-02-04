/**
 * Heartbeat Handler - Manages WebSocket ping/pong for connection health
 */

import type { WebSocket } from 'ws';

export interface HeartbeatConfig {
  intervalMs: number;
  timeoutMs: number;
}

interface ConnectionState {
  ws: WebSocket;
  lastPong: number;
  isAlive: boolean;
}

export class HeartbeatHandler {
  private connections = new Map<string, ConnectionState>();
  private intervalTimer?: NodeJS.Timeout;
  private readonly config: HeartbeatConfig;
  private onTimeout?: (sessionId: string) => void;

  constructor(config: HeartbeatConfig) {
    this.config = config;
  }

  setTimeoutCallback(callback: (sessionId: string) => void): void {
    this.onTimeout = callback;
  }

  start(): void {
    if (this.intervalTimer) return;

    this.intervalTimer = setInterval(() => {
      this.checkConnections();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    this.connections.clear();
  }

  addConnection(sessionId: string, ws: WebSocket): void {
    const state: ConnectionState = {
      ws,
      lastPong: Date.now(),
      isAlive: true,
    };

    this.connections.set(sessionId, state);

    ws.on('pong', () => {
      const conn = this.connections.get(sessionId);
      if (conn) {
        conn.lastPong = Date.now();
        conn.isAlive = true;
      }
    });
  }

  removeConnection(sessionId: string): void {
    this.connections.delete(sessionId);
  }

  private checkConnections(): void {
    const now = Date.now();

    for (const [sessionId, state] of this.connections) {
      if (!state.isAlive) {
        // Connection didn't respond to last ping
        const timeSinceLastPong = now - state.lastPong;
        if (timeSinceLastPong > this.config.timeoutMs) {
          console.log(`[Heartbeat] Connection ${sessionId} timed out`);
          this.onTimeout?.(sessionId);
          continue;
        }
      }

      // Mark as not alive and send ping
      state.isAlive = false;
      try {
        state.ws.ping();
      } catch (error) {
        console.error(`[Heartbeat] Failed to ping ${sessionId}:`, error);
        this.onTimeout?.(sessionId);
      }
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  isConnectionAlive(sessionId: string): boolean {
    return this.connections.get(sessionId)?.isAlive ?? false;
  }
}
