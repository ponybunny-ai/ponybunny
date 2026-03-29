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
import type { ILogger } from '../infra/observability/logger.js';
import { NoopLogger } from '../infra/observability/logger.js';

export interface IPCServerConfig {
  /** Unix socket path */
  socketPath: string;
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatIntervalMs?: number;
  /** Heartbeat timeout in milliseconds (default: 60000) */
  heartbeatTimeoutMs?: number;
  /** Optional structured logger (defaults to NoopLogger) */
  logger?: ILogger;
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
  private readonly logger: ILogger;

  constructor(config: IPCServerConfig) {
    this.logger = config.logger ?? new NoopLogger();
    this.config = {
      socketPath: config.socketPath,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 60000,
      logger: this.logger,
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
        this.logger.error({ event: 'ipc_server_error' }, 'Server error', error instanceof Error ? error : new Error(String(error)));
        if (!this.isRunning) {
          reject(new IPCError(IPCErrorType.CONNECTION_FAILED, 'Failed to start IPC server', error as Error));
        }
      });

      this.server.listen(this.config.socketPath, () => {
        this.isRunning = true;
        this.logger.info({ event: 'ipc_server_listening', socketPath: this.config.socketPath }, `Listening on ${this.config.socketPath}`);

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
          this.logger.info({ event: 'ipc_server_closed' }, 'Server closed');
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
    this.logger.info({ event: 'ipc_server_client_connected', clientId }, `Client connected: ${clientId}`);

    // Set up line-delimited JSON parser
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      // Guard against unbounded buffer growth
      const MAX_BUFFER = 1024 * 1024; // 1 MB
      if (buffer.length > MAX_BUFFER) {
        this.logger.error({ event: 'ipc_server_buffer_overflow', clientId, bufferLength: buffer.length }, `Client ${clientId} buffer exceeded 1 MB, dropping buffer`);
        buffer = '';
        return;
      }

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
      this.logger.error({ event: 'ipc_server_client_error', clientId }, `Client ${clientId} error`, error instanceof Error ? error : new Error(String(error)));
    });

    socket.on('close', () => {
      this.logger.info({ event: 'ipc_server_client_disconnected', clientId }, `Client disconnected: ${clientId}`);
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
          this.logger.info({ event: 'ipc_server_client_identified', clientId, clientInfo: message.data }, `Client ${clientId} identified`);
        }
        return;
      }

      // Handle disconnect messages
      if (message.type === 'disconnect') {
        const client = this.clients.get(clientId);
        if (client) {
          this.logger.info({ event: 'ipc_server_client_disconnecting', clientId, reason: message.data }, `Client ${clientId} disconnecting`);
          client.socket.end();
        }
        return;
      }

      // Forward message to handlers
      for (const handler of this.messageHandlers) {
        try {
          handler(message, clientId);
        } catch (error) {
          this.logger.error({ event: 'ipc_server_handler_error', clientId }, `Handler error for client ${clientId}`, error instanceof Error ? error : new Error(String(error)));
        }
      }
    } catch (error) {
      this.logger.error({ event: 'ipc_server_parse_error', clientId }, `Failed to parse message from ${clientId}`, error instanceof Error ? error : new Error(String(error)));
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
          this.logger.warn({ event: 'ipc_server_client_timeout', clientId, timeSinceLastPongMs: timeSinceLastPong }, `Client ${clientId} timed out (no pong for ${timeSinceLastPong}ms)`);
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
          this.logger.error({ event: 'ipc_server_ping_failed', clientId }, `Failed to send ping to ${clientId}`, error instanceof Error ? error : new Error(String(error)));
        }
      }
    }, this.config.heartbeatIntervalMs);
  }
}
