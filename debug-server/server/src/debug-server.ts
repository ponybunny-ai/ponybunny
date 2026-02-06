/**
 * Debug Server - Main service class that coordinates all components.
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';

import { SQLiteDebugStore } from './store/sqlite-store.js';
import { GatewayClient } from './gateway-client.js';
import { TokenManager } from './token-manager.js';
import { EventCollector } from './event-collector.js';
import { APIServer } from './api-server.js';

export interface DebugServerOptions {
  gatewayUrl?: string;
  adminToken?: string;
  dbPath?: string;
  host?: string;
  port?: number;
  metricsWindowMs?: number;
  reconnect?: boolean;
  staticDir?: string;
}

export class DebugServer {
  private store: SQLiteDebugStore | null = null;
  private gatewayClient: GatewayClient | null = null;
  private tokenManager: TokenManager | null = null;
  private collector: EventCollector | null = null;
  private apiServer: APIServer | null = null;

  private options: Required<DebugServerOptions>;
  private isRunning = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: DebugServerOptions = {}) {
    const defaultDbPath = join(homedir(), '.ponybunny', 'debug.db');

    this.options = {
      gatewayUrl: options.gatewayUrl ?? 'ws://127.0.0.1:18789',
      adminToken: options.adminToken ?? '',
      dbPath: options.dbPath ?? defaultDbPath,
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 18790,
      metricsWindowMs: options.metricsWindowMs ?? 300000,
      reconnect: options.reconnect ?? true,
      staticDir: options.staticDir ?? '',
    };
  }

  /**
   * Start the Debug Server.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Debug Server is already running');
    }

    console.log('[DebugServer] Starting...');

    try {
      // Ensure database directory exists
      const dbDir = join(this.options.dbPath, '..');
      await mkdir(dbDir, { recursive: true });

      // Initialize SQLite store
      this.store = new SQLiteDebugStore(this.options.dbPath);
      console.log(`[DebugServer] Database initialized at ${this.options.dbPath}`);

      // Initialize event collector
      this.collector = new EventCollector(this.store, {
        metricsWindowMs: this.options.metricsWindowMs,
      });

      // Initialize API server
      this.apiServer = new APIServer(this.store, this.collector, {
        host: this.options.host,
        port: this.options.port,
        staticDir: this.options.staticDir || undefined,
      });
      await this.apiServer.start();

      // Get admin token
      let adminToken = this.options.adminToken;
      if (!adminToken) {
        this.tokenManager = new TokenManager(this.options.gatewayUrl);
        try {
          const tokenInfo = await this.tokenManager.getToken();
          adminToken = tokenInfo.token;
          console.log('[DebugServer] Retrieved admin token');
        } catch (error) {
          console.warn('[DebugServer] Could not get admin token, will retry on connect:', error);
        }
      }

      // Initialize Gateway client
      this.gatewayClient = new GatewayClient({
        reconnect: this.options.reconnect,
      });

      this.gatewayClient.onEvent((event) => {
        this.collector!.ingest(event);
      });

      this.gatewayClient.onConnectionChange((connected) => {
        console.log(`[DebugServer] Gateway connection: ${connected ? 'connected' : 'disconnected'}`);
        this.apiServer?.setGatewayConnected(connected);
      });

      // Connect to Gateway if we have a token
      if (adminToken) {
        try {
          await this.gatewayClient.connect(this.options.gatewayUrl, adminToken);
        } catch (error) {
          console.warn('[DebugServer] Could not connect to Gateway:', error);
          // Continue running - will retry if reconnect is enabled
        }
      }

      // Start cleanup interval (daily)
      this.cleanupInterval = setInterval(() => {
        this.cleanupOldData();
      }, 24 * 60 * 60 * 1000);

      this.isRunning = true;
      console.log('[DebugServer] Started successfully');
      console.log(`[DebugServer] Web UI available at http://${this.options.host}:${this.options.port}`);
    } catch (error) {
      // Cleanup on failure
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the Debug Server.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[DebugServer] Stopping...');
    this.isRunning = false;

    await this.cleanup();
    console.log('[DebugServer] Stopped');
  }

  /**
   * Check if the server is running.
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get server status.
   */
  getStatus(): Record<string, unknown> {
    return {
      isRunning: this.isRunning,
      gatewayConnected: this.gatewayClient?.isConnected() ?? false,
      eventCount: this.store?.getEventCount() ?? 0,
      apiUrl: this.isRunning ? `http://${this.options.host}:${this.options.port}` : null,
    };
  }

  private async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.gatewayClient) {
      this.gatewayClient.disconnect();
      this.gatewayClient = null;
    }

    if (this.apiServer) {
      await this.apiServer.stop();
      this.apiServer = null;
    }

    if (this.collector) {
      // Flush any pending metrics
      this.collector.flushMetrics();
      this.collector = null;
    }

    if (this.store) {
      this.store.close();
      this.store = null;
    }
  }

  private cleanupOldData(): void {
    if (!this.store) {
      return;
    }

    const retentionDays = 7;
    const deleted = this.store.cleanupOldEvents(retentionDays);
    if (deleted > 0) {
      console.log(`[DebugServer] Cleaned up ${deleted} old events`);
    }
  }
}
