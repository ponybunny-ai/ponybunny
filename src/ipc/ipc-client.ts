/**
 * IPC Client - Unix Domain Socket Client for Scheduler Daemon
 *
 * Connects to Gateway IPC server and sends scheduler/debug events.
 * Implements auto-reconnection with exponential backoff and message buffering.
 */

import { connect, Socket } from 'net';
import type { AnyIPCMessage, IPCMessage, IPCConnectionState } from './types.js';
import { IPCError, IPCErrorType } from './types.js';

export interface IPCClientConfig {
  /** Unix socket path to connect to */
  socketPath: string;
  /** Enable auto-reconnection (default: true) */
  autoReconnect?: boolean;
  /** Initial reconnection delay in milliseconds (default: 1000) */
  reconnectDelayMs?: number;
  /** Maximum reconnection delay in milliseconds (default: 30000) */
  maxReconnectDelayMs?: number;
  /** Maximum number of buffered messages during disconnection (default: 1000) */
  maxBufferSize?: number;
  /** Client identification */
  clientInfo?: {
    clientType: string;
    version: string;
    pid: number;
  };
}

export type IPCConnectionStateHandler = (state: IPCConnectionState) => void;

export class IPCClient {
  private socket: Socket | null = null;
  private config: Required<IPCClientConfig>;
  private state: IPCConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectDelay: number;
  private messageBuffer: AnyIPCMessage[] = [];
  private stateHandlers: Set<IPCConnectionStateHandler> = new Set();
  private socketBuffer = '';

  constructor(config: IPCClientConfig) {
    this.config = {
      socketPath: config.socketPath,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30000,
      maxBufferSize: config.maxBufferSize ?? 1000,
      clientInfo: config.clientInfo ?? {
        clientType: 'scheduler-daemon',
        version: '1.0.0',
        pid: process.pid,
      },
    };
    this.currentReconnectDelay = this.config.reconnectDelayMs;
  }

  /**
   * Connect to the IPC server.
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');

    return new Promise((resolve, reject) => {
      this.socket = connect(this.config.socketPath);

      const onConnect = () => {
        this.socket!.off('error', onError);
        this.setState('connected');
        this.currentReconnectDelay = this.config.reconnectDelayMs;
        console.log(`[IPCClient] Connected to ${this.config.socketPath}`);

        // Send connect message
        this.sendConnectMessage();

        // Flush buffered messages
        this.flushBuffer();

        resolve();
      };

      const onError = (error: Error) => {
        this.socket!.off('connect', onConnect);
        this.socket = null;
        this.setState('disconnected');

        const ipcError = new IPCError(
          IPCErrorType.CONNECTION_FAILED,
          `Failed to connect to ${this.config.socketPath}`,
          error
        );

        if (this.config.autoReconnect) {
          console.warn(`[IPCClient] Connection failed, will retry in ${this.currentReconnectDelay}ms`);
          this.scheduleReconnect();
          resolve(); // Don't reject, we'll retry
        } else {
          reject(ipcError);
        }
      };

      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);

      this.setupSocketHandlers();
    });
  }

  /**
   * Disconnect from the IPC server.
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      // Send disconnect message
      try {
        const disconnectMessage: AnyIPCMessage = {
          type: 'disconnect',
          timestamp: Date.now(),
          data: { reason: 'client_shutdown' },
        };
        this.socket.write(JSON.stringify(disconnectMessage) + '\n');
      } catch (error) {
        // Ignore errors during disconnect
      }

      this.socket.end();
      this.socket = null;
    }

    this.setState('disconnected');
    console.log('[IPCClient] Disconnected');
  }

  /**
   * Send a message to the server.
   */
  async send(message: AnyIPCMessage): Promise<void> {
    if (this.state !== 'connected' || !this.socket) {
      // Buffer message if disconnected
      if (this.messageBuffer.length < this.config.maxBufferSize) {
        this.messageBuffer.push(message);
      } else {
        // Drop oldest message
        this.messageBuffer.shift();
        this.messageBuffer.push(message);
        console.warn('[IPCClient] Message buffer full, dropped oldest message');
      }
      return;
    }

    return new Promise((resolve, reject) => {
      const data = JSON.stringify(message) + '\n';
      this.socket!.write(data, (error) => {
        if (error) {
          reject(new IPCError(IPCErrorType.SEND_FAILED, 'Failed to send message', error));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Check if client is connected.
   */
  isConnected(): boolean {
    return this.state === 'connected';
  }

  /**
   * Get current connection state.
   */
  getState(): IPCConnectionState {
    return this.state;
  }

  /**
   * Get number of buffered messages.
   */
  getBufferSize(): number {
    return this.messageBuffer.length;
  }

  /**
   * Register a connection state handler.
   */
  onStateChange(handler: IPCConnectionStateHandler): void {
    this.stateHandlers.add(handler);
  }

  /**
   * Unregister a connection state handler.
   */
  offStateChange(handler: IPCConnectionStateHandler): void {
    this.stateHandlers.delete(handler);
  }

  /**
   * Set connection state and notify handlers.
   */
  private setState(state: IPCConnectionState): void {
    if (this.state === state) {
      return;
    }

    this.state = state;
    console.log(`[IPCClient] State changed: ${state}`);

    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch (error) {
        console.error('[IPCClient] State handler error:', error);
      }
    }
  }

  /**
   * Set up socket event handlers.
   */
  private setupSocketHandlers(): void {
    if (!this.socket) {
      return;
    }

    this.socket.on('data', (data) => {
      this.socketBuffer += data.toString();

      // Process complete lines
      let newlineIndex: number;
      while ((newlineIndex = this.socketBuffer.indexOf('\n')) !== -1) {
        const line = this.socketBuffer.slice(0, newlineIndex);
        this.socketBuffer = this.socketBuffer.slice(newlineIndex + 1);

        if (line.trim()) {
          this.handleMessage(line);
        }
      }
    });

    this.socket.on('error', (error) => {
      console.error('[IPCClient] Socket error:', error);
    });

    this.socket.on('close', () => {
      console.log('[IPCClient] Connection closed');
      this.socket = null;
      this.setState('disconnected');

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Handle incoming message from server.
   */
  private handleMessage(line: string): void {
    try {
      const message = JSON.parse(line) as IPCMessage;

      // Handle ping messages (respond with pong)
      if (message.type === 'ping') {
        const pongMessage: AnyIPCMessage = {
          type: 'pong',
          timestamp: Date.now(),
        };
        this.send(pongMessage).catch((error) => {
          console.error('[IPCClient] Failed to send pong:', error);
        });
      }
    } catch (error) {
      console.error('[IPCClient] Failed to parse message:', error);
    }
  }

  /**
   * Send connect message with client info.
   */
  private sendConnectMessage(): void {
    const connectMessage: AnyIPCMessage = {
      type: 'connect',
      timestamp: Date.now(),
      data: {
        clientType: 'scheduler-daemon' as const,
        version: this.config.clientInfo.version,
        pid: this.config.clientInfo.pid,
      },
    };

    this.send(connectMessage).catch((error) => {
      console.error('[IPCClient] Failed to send connect message:', error);
    });
  }

  /**
   * Flush buffered messages.
   */
  private flushBuffer(): void {
    if (this.messageBuffer.length === 0) {
      return;
    }

    console.log(`[IPCClient] Flushing ${this.messageBuffer.length} buffered messages`);

    const messages = [...this.messageBuffer];
    this.messageBuffer = [];

    for (const message of messages) {
      this.send(message).catch((error) => {
        console.error('[IPCClient] Failed to send buffered message:', error);
        // Re-buffer failed message
        if (this.messageBuffer.length < this.config.maxBufferSize) {
          this.messageBuffer.push(message);
        }
      });
    }
  }

  /**
   * Schedule reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`[IPCClient] Attempting to reconnect...`);

      this.connect().catch((error) => {
        console.error('[IPCClient] Reconnection failed:', error);
      });

      // Increase delay for next attempt (exponential backoff)
      this.currentReconnectDelay = Math.min(
        this.currentReconnectDelay * 2,
        this.config.maxReconnectDelayMs
      );
    }, this.currentReconnectDelay);
  }
}
