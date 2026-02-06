/**
 * Debug Web Server - HTTP server with WebSocket proxy for browser-based debug UI
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { getPublicKey, signChallenge, hasKeyPair } from '../lib/key-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DebugWebServerOptions {
  webPort: number;
  gatewayUrl: string;
  token: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

/**
 * Debug Web Server that serves the HTML UI and proxies WebSocket connections to Gateway
 */
export class DebugWebServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private gatewayWs: WebSocket | null = null;
  private browserClients = new Set<WebSocket>();
  private pending = new Map<string, PendingRequest>();
  private authenticated = false;
  private options: DebugWebServerOptions;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(options: DebugWebServerOptions) {
    this.options = options;
  }

  /**
   * Start the web server
   */
  async start(): Promise<void> {
    // Connect to Gateway first
    await this.connectToGateway();

    // Start HTTP server
    this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));

    // Start WebSocket server for browser clients
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws) => this.handleBrowserConnection(ws));

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.options.webPort, () => {
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  /**
   * Stop the web server
   */
  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const client of this.browserClients) {
      client.close();
    }
    this.browserClients.clear();

    if (this.gatewayWs) {
      this.gatewayWs.close();
      this.gatewayWs = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  /**
   * Handle HTTP requests - serve static HTML
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only serve the index.html for root path
    if (req.url === '/' || req.url === '/index.html') {
      try {
        // Try to load from source directory first (development)
        let htmlPath = join(__dirname, 'html', 'index.html');
        let html: string;
        try {
          html = readFileSync(htmlPath, 'utf-8');
        } catch {
          // Try dist directory (production)
          htmlPath = join(__dirname, '..', '..', '..', 'dist', 'cli', 'debug-webui', 'html', 'index.html');
          html = readFileSync(htmlPath, 'utf-8');
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load index.html');
      }
    } else if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        gatewayConnected: this.authenticated,
        browserClients: this.browserClients.size,
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  /**
   * Handle browser WebSocket connection
   */
  private handleBrowserConnection(ws: WebSocket): void {
    this.browserClients.add(ws);

    // Send initial connection status
    ws.send(JSON.stringify({
      type: 'event',
      event: 'connection.status',
      data: { connected: this.authenticated },
    }));

    ws.on('message', (data) => {
      this.handleBrowserMessage(ws, data.toString());
    });

    ws.on('close', () => {
      this.browserClients.delete(ws);
    });

    ws.on('error', () => {
      this.browserClients.delete(ws);
    });
  }

  /**
   * Handle message from browser - forward to Gateway
   */
  private handleBrowserMessage(browserWs: WebSocket, raw: string): void {
    if (!this.gatewayWs || this.gatewayWs.readyState !== WebSocket.OPEN || !this.authenticated) {
      // Send error response back to browser
      try {
        const frame = JSON.parse(raw);
        if (frame.type === 'req') {
          browserWs.send(JSON.stringify({
            type: 'res',
            id: frame.id,
            error: { code: -1, message: 'Not connected to Gateway' },
          }));
        }
      } catch {
        // Ignore parse errors
      }
      return;
    }

    // Forward request to Gateway
    this.gatewayWs.send(raw);
  }

  /**
   * Connect to Gateway server with authentication
   */
  private async connectToGateway(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.options.gatewayUrl);

      ws.on('open', async () => {
        this.gatewayWs = ws;
        try {
          await this.authenticateWithGateway();
          this.authenticated = true;
          this.broadcastToBrowsers({
            type: 'event',
            event: 'connection.status',
            data: { connected: true },
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      ws.on('message', (data) => {
        this.handleGatewayMessage(data.toString());
      });

      ws.on('close', () => {
        this.authenticated = false;
        this.broadcastToBrowsers({
          type: 'event',
          event: 'connection.status',
          data: { connected: false },
        });
        this.scheduleReconnect();
      });

      ws.on('error', (error) => {
        if (!this.authenticated) {
          reject(error);
        }
      });
    });
  }

  /**
   * Authenticate with Gateway using token or keypair
   */
  private async authenticateWithGateway(): Promise<void> {
    if (this.options.token) {
      // Use pairing token
      const pairResult = await this.gatewayRequest<{ challenge: string }>('auth.pair', {
        token: this.options.token,
      });

      const publicKey = getPublicKey();
      const signature = signChallenge(pairResult.challenge);

      await this.gatewayRequest('auth.verify', { signature, publicKey });
    } else if (hasKeyPair()) {
      // Use existing keypair
      const publicKey = getPublicKey();
      const helloResult = await this.gatewayRequest<{ challenge: string }>('auth.hello', { publicKey });
      const signature = signChallenge(helloResult.challenge);
      await this.gatewayRequest('auth.verify', { signature });
    } else {
      throw new Error('No authentication credentials available');
    }
  }

  /**
   * Send request to Gateway and wait for response
   */
  private gatewayRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.gatewayWs || this.gatewayWs.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Gateway'));
        return;
      }

      const id = randomUUID();
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });

      this.gatewayWs.send(JSON.stringify({
        type: 'req',
        id,
        method,
        params,
      }));
    });
  }

  /**
   * Handle message from Gateway - forward to browsers or resolve pending request
   */
  private handleGatewayMessage(raw: string): void {
    let frame: { type: string; id?: string; result?: unknown; error?: { message: string }; event?: string; data?: unknown };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (frame.type === 'res') {
      // Check if this is a response to our internal request
      const pending = this.pending.get(frame.id!);
      if (pending) {
        this.pending.delete(frame.id!);
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        if (frame.error) {
          pending.reject(new Error(frame.error.message));
        } else {
          pending.resolve(frame.result);
        }
        return;
      }
    }

    // Forward to all browser clients
    this.broadcastToBrowsers(frame);
  }

  /**
   * Broadcast message to all connected browsers
   */
  private broadcastToBrowsers(message: unknown): void {
    const raw = JSON.stringify(message);
    for (const client of this.browserClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  /**
   * Schedule reconnection to Gateway
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectToGateway();
      } catch {
        this.scheduleReconnect();
      }
    }, 3000);
  }
}
