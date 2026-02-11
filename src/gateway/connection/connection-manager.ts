/**
 * Connection Manager - Manages WebSocket connections and sessions
 */

import type { WebSocket } from 'ws';
import { Session } from './session.js';
import { HeartbeatHandler, type HeartbeatConfig } from './heartbeat.js';
import type { SessionData, Permission, ResponseFrame, EventFrame } from '../types.js';
import { EventBus } from '../events/event-bus.js';

export interface ConnectionManagerConfig {
  maxConnectionsPerIp: number;
  maxLocalConnections?: number; // Separate limit for local connections
  heartbeat: HeartbeatConfig;
}

interface PendingConnection {
  ws: WebSocket;
  remoteAddress: string;
  connectedAt: number;
  authTimeoutTimer: NodeJS.Timeout;
}

export class ConnectionManager {
  private sessions = new Map<string, Session>();
  private websockets = new Map<string, WebSocket>();
  private ipConnectionCounts = new Map<string, number>();
  private pendingConnections = new Map<WebSocket, PendingConnection>();
  private sessionRemoteAddresses = new Map<string, string>(); // Track IP for authenticated sessions
  private heartbeat: HeartbeatHandler;
  private eventBus: EventBus;
  private config: ConnectionManagerConfig;

  constructor(config: ConnectionManagerConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
    this.heartbeat = new HeartbeatHandler(config.heartbeat);

    this.heartbeat.setTimeoutCallback((sessionId) => {
      this.disconnectSession(sessionId, 'heartbeat_timeout');
    });
  }

  start(): void {
    this.heartbeat.start();
  }

  stop(): void {
    this.heartbeat.stop();

    // Clear all pending auth timeouts
    for (const pending of this.pendingConnections.values()) {
      clearTimeout(pending.authTimeoutTimer);
    }
    this.pendingConnections.clear();

    // Close all connections
    for (const [sessionId, ws] of this.websockets) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // Ignore close errors during shutdown
      }
      this.sessions.delete(sessionId);
    }
    this.websockets.clear();
    this.ipConnectionCounts.clear();
    this.sessionRemoteAddresses.clear();
  }

  canAcceptConnection(remoteAddress: string): boolean {
    const count = this.ipConnectionCounts.get(remoteAddress) || 0;

    // Use higher limit for local connections
    if (this.isLocalAddress(remoteAddress)) {
      const maxLocal = this.config.maxLocalConnections ?? 512;
      return count < maxLocal;
    }

    return count < this.config.maxConnectionsPerIp;
  }

  private isLocalAddress(address: string): boolean {
    return (
      address === '127.0.0.1' ||
      address === 'localhost' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1'
    );
  }

  addPendingConnection(ws: WebSocket, remoteAddress: string, authTimeoutMs: number): void {
    const authTimeoutTimer = setTimeout(() => {
      this.rejectPendingConnection(ws, 'auth_timeout');
    }, authTimeoutMs);

    this.pendingConnections.set(ws, {
      ws,
      remoteAddress,
      connectedAt: Date.now(),
      authTimeoutTimer,
    });

    // Track IP connection count
    const count = this.ipConnectionCounts.get(remoteAddress) || 0;
    this.ipConnectionCounts.set(remoteAddress, count + 1);
  }

  rejectPendingConnection(ws: WebSocket, reason: string): void {
    const pending = this.pendingConnections.get(ws);
    if (!pending) return;

    clearTimeout(pending.authTimeoutTimer);
    this.pendingConnections.delete(ws);

    // Decrement IP count
    const count = this.ipConnectionCounts.get(pending.remoteAddress) || 1;
    if (count <= 1) {
      this.ipConnectionCounts.delete(pending.remoteAddress);
    } else {
      this.ipConnectionCounts.set(pending.remoteAddress, count - 1);
    }

    try {
      ws.close(4001, reason);
    } catch {
      // Ignore close errors
    }
  }

  promoteConnection(ws: WebSocket, sessionData: SessionData): Session {
    const pending = this.pendingConnections.get(ws);
    let remoteAddress: string | undefined;
    if (pending) {
      clearTimeout(pending.authTimeoutTimer);
      remoteAddress = pending.remoteAddress;
      this.pendingConnections.delete(ws);
    }

    const session = new Session(sessionData);
    this.sessions.set(session.id, session);
    this.websockets.set(session.id, ws);
    this.heartbeat.addConnection(session.id, ws);

    // Track remote address for IP count management
    if (remoteAddress) {
      this.sessionRemoteAddresses.set(session.id, remoteAddress);
    }

    this.eventBus.emit('connection.authenticated', {
      sessionId: session.id,
      publicKey: session.publicKey,
      permissions: session.permissions,
    });

    return session;
  }

  disconnectSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    const ws = this.websockets.get(sessionId);

    if (session) {
      this.eventBus.emit('connection.disconnected', {
        sessionId,
        publicKey: session.publicKey,
        reason,
      });
    }

    // Decrement IP connection count
    const remoteAddress = this.sessionRemoteAddresses.get(sessionId);
    if (remoteAddress) {
      const count = this.ipConnectionCounts.get(remoteAddress) || 1;
      if (count <= 1) {
        this.ipConnectionCounts.delete(remoteAddress);
      } else {
        this.ipConnectionCounts.set(remoteAddress, count - 1);
      }
      this.sessionRemoteAddresses.delete(sessionId);
    }

    this.sessions.delete(sessionId);
    this.websockets.delete(sessionId);
    this.heartbeat.removeConnection(sessionId);

    if (ws) {
      try {
        ws.close(1000, reason);
      } catch {
        // Ignore close errors
      }
    }
  }

  handleDisconnect(ws: WebSocket): void {
    // Check if it's a pending connection
    const pending = this.pendingConnections.get(ws);
    if (pending) {
      clearTimeout(pending.authTimeoutTimer);
      this.pendingConnections.delete(ws);

      const count = this.ipConnectionCounts.get(pending.remoteAddress) || 1;
      if (count <= 1) {
        this.ipConnectionCounts.delete(pending.remoteAddress);
      } else {
        this.ipConnectionCounts.set(pending.remoteAddress, count - 1);
      }
      return;
    }

    // Find and remove authenticated session
    for (const [sessionId, sessionWs] of this.websockets) {
      if (sessionWs === ws) {
        this.disconnectSession(sessionId, 'client_disconnect');
        break;
      }
    }
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByWebSocket(ws: WebSocket): Session | undefined {
    for (const [sessionId, sessionWs] of this.websockets) {
      if (sessionWs === ws) {
        return this.sessions.get(sessionId);
      }
    }
    return undefined;
  }

  getWebSocket(sessionId: string): WebSocket | undefined {
    return this.websockets.get(sessionId);
  }

  isPending(ws: WebSocket): boolean {
    return this.pendingConnections.has(ws);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionsSubscribedToGoal(goalId: string): Session[] {
    return this.getAllSessions().filter(s => s.isSubscribedToGoal(goalId));
  }

  getSessionsWithPermission(permission: Permission): Session[] {
    return this.getAllSessions().filter(s => s.hasPermission(permission));
  }

  sendToSession(sessionId: string, frame: ResponseFrame | EventFrame): boolean {
    const ws = this.websockets.get(sessionId);
    if (!ws || ws.readyState !== 1) { // 1 = OPEN
      return false;
    }

    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      console.error(`[ConnectionManager] Failed to send to ${sessionId}:`, error);
      return false;
    }
  }

  broadcast(frame: EventFrame, filter?: (session: Session) => boolean): number {
    let sent = 0;
    for (const session of this.sessions.values()) {
      if (!filter || filter(session)) {
        if (this.sendToSession(session.id, frame)) {
          sent++;
        }
      }
    }
    return sent;
  }

  getStats(): {
    totalSessions: number;
    pendingConnections: number;
    uniqueIps: number;
    connectionsByIp: Record<string, number>;
  } {
    const connectionsByIp: Record<string, number> = {};
    for (const [ip, count] of this.ipConnectionCounts.entries()) {
      connectionsByIp[ip] = count;
    }

    return {
      totalSessions: this.sessions.size,
      pendingConnections: this.pendingConnections.size,
      uniqueIps: this.ipConnectionCounts.size,
      connectionsByIp,
    };
  }

  /**
   * Get connection count for a specific IP address
   */
  getConnectionCount(remoteAddress: string): { current: number; max: number } {
    const current = this.ipConnectionCounts.get(remoteAddress) || 0;
    const isLocal = this.isLocalAddress(remoteAddress);
    const max = isLocal ? (this.config.maxLocalConnections ?? 512) : this.config.maxConnectionsPerIp;
    return { current, max };
  }

  /**
   * Get all active sessions with their details for debug purposes
   */
  getActiveSessions(): Array<{
    id: string;
    publicKey: string;
    permissions: string[];
    subscribedGoals: string[];
    connectedAt: number;
  }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      publicKey: session.publicKey,
      permissions: session.permissions,
      subscribedGoals: session.getSubscribedGoals(),
      connectedAt: session.connectedAt,
    }));
  }

  /**
   * Get sessions subscribed to debug events
   */
  getDebugSubscribers(): Session[] {
    return this.getAllSessions().filter(s => s.isSubscribedToDebugEvents());
  }
}
