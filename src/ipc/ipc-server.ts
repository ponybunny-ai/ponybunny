/**
 * IPC Server - Unix Domain Socket Server for Gateway
 *
 * Accepts connections from Scheduler Daemon and routes messages to Gateway EventBus.
 * Implements heartbeat mechanism to detect dead connections.
 */

import { createServer, Server, Socket } from 'net';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import type { AnyIPCMessage, IPCMessage } from './types.js';
import { IPCError, IPCErrorType } from './types.js';

export interface IPCServerConfig {
  /** Unix socket path */
  socketPath: string;
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatIntervalMs?: number;
  /** Heartbeat timeout in milliseconds (default: 60000) */
  heartbeatTimeoutMs?: number;
}

export type IPCMessageHandler = (message: AnyIPCMessage, clientId: string) => void;

interface ClientConnection {
  socket: Socket;
  id: string;
  connectedAt: number;
  lastPingAt: number;
  lastPongAt: number;
  clientInfo?: {
    clientType: string;
    version: string;
    pid: number;
  };
}

export class IPCServer {
  private server: Server | null = null;
  private clients = new Map<string, ClientConnection>();
  private messageHandlers: Set<IPCMessageHandler> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private config: Required<IPCServerConfig>;
  private isRunning = false;
  private nextClientId = 1;

  constructor(config: IPCServerConfig) {
    this.config = {
      socketPath: config.socketPath,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 60000,
    };
  }

  /**
   * Start the IPC server and listen for connections.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('IPC Server is already running');
    }

    // Remove existing socket file if it exists
    if (existsSync(this.config.socketPath)) {
      await unlink(this.config.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (error) => {
        console.error('[IPCServer] Server error:', error);
        if (!this.isRunning) {
          reject(new IPCError(IPCErrorType.CONNECTION_FAILED, 'Failed to start IPC server', error as Error));
        }
      });

      this.server.listen(this.config.socketPath, () => {
        this.isRunning = true;
        console.log(`[IPCServer] Listening on ${this.config.socketPath}`);

        // Start heartbeat mechanism
        this.startHeartbeat();

        resolve();
      });
    });
  }

  /**
   * Stop the IPC server and close all connections.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      client.socket.end();
      this.clients.delete(clientId);
    }

    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          console.log('[IPCServer] Server closed');
          resolve();
        });
      });
      this.server = null;
    }

    // Remove socket file
    if (existsSync(this.config.socketPath)) {
      await unlink(this.config.socketPath);
    }
  }

  /**
   * Register a message handler.
   */
  onMessage(handler: IPCMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  /**
   * Unregister a message handler.
   */
  offMessage(handler: IPCMessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  /**
   * Get number of connected clients.
   */
  getConnectedClients(): number {
    return this.clients.size;
  }

  /**
   * Get client information.
   */
  getClients(): Array<{ id: string; connectedAt: number; clientInfo?: any }> {
    return Array.from(this.clients.values()).map((client) => ({
      id: client.id,
      connectedAt: client.connectedAt,
      clientInfo: client.clientInfo,
    }));
  }

  sendToClient(clientId: string, message: AnyIPCMessage): void {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new IPCError(IPCErrorType.SEND_FAILED, `IPC client not found: ${clientId}`);
    }

    client.socket.write(JSON.stringify(message) + '\n');
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: Socket): void {
    const clientId = `client-${this.nextClientId++}`;
    const now = Date.now();

    const client: ClientConnection = {
      socket,
      id: clientId,
      connectedAt: now,
      lastPingAt: now,
      lastPongAt: now,
    };

    this.clients.set(clientId, client);
    console.log(`[IPCServer] Client connected: ${clientId}`);

    // Set up line-delimited JSON parser
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Process complete lines
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          this.handleMessage(clientId, line);
        }
      }
    });

    socket.on('error', (error) => {
      console.error(`[IPCServer] Client ${clientId} error:`, error);
    });

    socket.on('close', () => {
      console.log(`[IPCServer] Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
    });
  }

  /**
   * Handle incoming message from client.
   */
  private handleMessage(clientId: string, line: string): void {
    try {
      const message = JSON.parse(line) as AnyIPCMessage;

      // Handle pong messages (update last pong time)
      if (message.type === 'pong') {
        const client = this.clients.get(clientId);
        if (client) {
          client.lastPongAt = Date.now();
        }
        return;
      }

      // Handle connect messages (store client info)
      if (message.type === 'connect' && message.data) {
        const client = this.clients.get(clientId);
        if (client) {
          client.clientInfo = message.data as any;
          console.log(`[IPCServer] Client ${clientId} identified:`, message.data);
        }
        return;
      }

      // Handle disconnect messages
      if (message.type === 'disconnect') {
        const client = this.clients.get(clientId);
        if (client) {
          console.log(`[IPCServer] Client ${clientId} disconnecting:`, message.data);
          client.socket.end();
        }
        return;
      }

      // Forward message to handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(message, clientId);
        } catch (error) {
          console.error(`[IPCServer] Handler error for client ${clientId}:`, error);
        }
      }
    } catch (error) {
      console.error(`[IPCServer] Failed to parse message from ${clientId}:`, error);
    }
  }

  /**
   * Start heartbeat mechanism.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.clients) {
        // Check if client has timed out
        const timeSinceLastPong = now - client.lastPongAt;
        if (timeSinceLastPong > this.config.heartbeatTimeoutMs) {
          console.warn(`[IPCServer] Client ${clientId} timed out (no pong for ${timeSinceLastPong}ms)`);
          client.socket.end();
          this.clients.delete(clientId);
          continue;
        }

        // Send ping
        const pingMessage: IPCMessage = {
          type: 'ping',
          timestamp: now,
        };

        try {
          client.socket.write(JSON.stringify(pingMessage) + '\n');
          client.lastPingAt = now;
        } catch (error) {
          console.error(`[IPCServer] Failed to send ping to ${clientId}:`, error);
        }
      }
    }, this.config.heartbeatIntervalMs);
  }
}
