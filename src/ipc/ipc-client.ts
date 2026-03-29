/**
 * IPC Client - Unix Domain Socket Client for Scheduler Daemon
 *
 * Connects to Gateway IPC server and sends scheduler/debug events.
 * Implements auto-reconnection with exponential backoff and message buffering.
 */

import { connect, Socket } from 'net';
import type { AnyIPCMessage, IPCConnectionState } from './types.js';
import { IPCError, IPCErrorType } from './types.js';
import type { ILogger } from '../infra/observability/logger.js';
import { NoopLogger } from '../infra/observability/logger.js';
import { BackpressureBuffer, type BackpressureConfig } from './backpressure-buffer.js';

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
  /** Backpressure buffer configuration (overrides maxBufferSize when provided) */
  backpressure?: Partial<BackpressureConfig>;
  /** Client identification */
  clientInfo?: {
    clientType: string;
    version: string;
    pid: number;
  };
  /** Optional structured logger (defaults to NoopLogger) */
  logger?: ILogger;
}

export type IPCConnectionStateHandler = (state: IPCConnectionState) => void;
export type IPCMessageHandler = (message: AnyIPCMessage) => void;

export class IPCClient {
  private socket: Socket | null = null;
  private config: Required<IPCClientConfig>;
  private state: IPCConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentReconnectDelay: number;
  private messageBuffer: BackpressureBuffer<AnyIPCMessage>;
  private stateHandlers: Set<IPCConnectionStateHandler> = new Set();
  private messageHandlers: Set<IPCMessageHandler> = new Set();
  private socketBuffer = '';
  private readonly logger: ILogger;

  constructor(config: IPCClientConfig) {
    this.logger = config.logger ?? new NoopLogger();
    this.config = {
      socketPath: config.socketPath,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelayMs: config.reconnectDelayMs ?? 1000,
      maxReconnectDelayMs: config.maxReconnectDelayMs ?? 30000,
      maxBufferSize: config.maxBufferSize ?? 1000,
      backpressure: config.backpressure ?? {},
      clientInfo: config.clientInfo ?? {
        clientType: 'scheduler-daemon',
        version: '1.0.0',
        pid: process.pid,
      },
      logger: this.logger,
    };

    const bpConfig: Partial<BackpressureConfig> = {
      maxSize: this.config.maxBufferSize,
      ...this.config.backpressure,
    };

    this.messageBuffer = new BackpressureBuffer<AnyIPCMessage>(
      bpConfig,
      {
        onDrop: (_msg, size) => this.logger.warn({ event: 'ipc.message.dropped', bufferSize: size }, 'Message dropped from buffer'),
        onPressure: (size) => this.logger.warn({ event: 'ipc.backpressure.warning', bufferSize: size }, 'Buffer backpressure threshold reached'),
      },
    );

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
        this.logger.info({ event: 'ipc_client_connected', socketPath: this.config.socketPath }, `Connected to ${this.config.socketPath}`);

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
          this.logger.warn({ event: 'ipc_client_connection_failed', retryDelayMs: this.currentReconnectDelay }, `Connection failed, will retry in ${this.currentReconnectDelay}ms`);
          this.scheduleReconnect();
          reject(ipcError); // Reject so caller knows initial connect failed
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
    this.logger.info({ event: 'ipc_client_disconnected' }, 'Disconnected');
  }

  /**
   * Send a message to the server.
   */
  async send(message: AnyIPCMessage): Promise<void> {
    if (this.state !== 'connected' || !this.socket) {
      // Buffer message if disconnected; BackpressureBuffer handles drop policy and callbacks
      this.messageBuffer.enqueue(message);
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
    return this.messageBuffer.size;
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

  onMessage(handler: IPCMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  offMessage(handler: IPCMessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  /**
   * Set connection state and notify handlers.
   */
  private setState(state: IPCConnectionState): void {
    if (this.state === state) {
      return;
    }

    this.state = state;
    this.logger.debug({ event: 'ipc_client_state_changed', state }, `State changed: ${state}`);

    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch (error) {
        this.logger.error({ event: 'ipc_client_state_handler_error' }, 'State handler error', error instanceof Error ? error : new Error(String(error)));
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

      // Guard against unbounded buffer growth (e.g. peer sends data without newlines)
      const MAX_SOCKET_BUFFER = 1024 * 1024; // 1 MB
      if (this.socketBuffer.length > MAX_SOCKET_BUFFER) {
        this.logger.error({ event: 'ipc_client_buffer_overflow', bufferLength: this.socketBuffer.length }, 'Socket buffer exceeded 1 MB, dropping buffer');
        this.socketBuffer = '';
        return;
      }

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
      this.logger.error({ event: 'ipc_client_socket_error' }, 'Socket error', error instanceof Error ? error : new Error(String(error)));
    });

    this.socket.on('close', () => {
      this.logger.info({ event: 'ipc_client_connection_closed' }, 'Connection closed');
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
      const message = JSON.parse(line) as AnyIPCMessage;

      // Handle ping messages (respond with pong)
      if (message.type === 'ping') {
        const pongMessage: AnyIPCMessage = {
          type: 'pong',
          timestamp: Date.now(),
        };
        this.send(pongMessage).catch((error) => {
          this.logger.error({ event: 'ipc_client_pong_failed' }, 'Failed to send pong', error instanceof Error ? error : new Error(String(error)));
        });
        return;
      }

      for (const handler of this.messageHandlers) {
        try {
          handler(message);
        } catch (error) {
          this.logger.error({ event: 'ipc_client_message_handler_error' }, 'Message handler error', error instanceof Error ? error : new Error(String(error)));
        }
      }
    } catch (error) {
      this.logger.error({ event: 'ipc_client_parse_error' }, 'Failed to parse message', error instanceof Error ? error : new Error(String(error)));
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
      this.logger.error({ event: 'ipc_client_connect_message_failed' }, 'Failed to send connect message', error instanceof Error ? error : new Error(String(error)));
    });
  }

  /**
   * Flush buffered messages.
   */
  private flushBuffer(): void {
    if (this.messageBuffer.size === 0) {
      return;
    }

    this.logger.info({ event: 'ipc_client_flush_buffer', count: this.messageBuffer.size }, `Flushing ${this.messageBuffer.size} buffered messages`);

    const messages = this.messageBuffer.drain();

    for (const message of messages) {
      this.send(message).catch((error) => {
        this.logger.error({ event: 'ipc_client_buffered_send_failed' }, 'Failed to send buffered message', error instanceof Error ? error : new Error(String(error)));
        // Re-buffer failed message
        this.messageBuffer.enqueue(message);
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
      this.logger.info({ event: 'ipc_client_reconnect_attempt', delayMs: this.currentReconnectDelay }, 'Attempting to reconnect');

      this.connect().catch((error) => {
        this.logger.error({ event: 'ipc_client_reconnect_failed' }, 'Reconnection failed', error instanceof Error ? error : new Error(String(error)));
      });

      // Increase delay for next attempt (exponential backoff)
      this.currentReconnectDelay = Math.min(
        this.currentReconnectDelay * 2,
        this.config.maxReconnectDelayMs
      );
    }, this.currentReconnectDelay);
  }
}
