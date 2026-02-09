/**
 * Debug API Server - HTTP + WebSocket server for Debug UI.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { IDebugDataStore } from './store/types.js';
import type { EventCollector } from './event-collector.js';
import type { EnrichedEvent, EventFilter, GoalFilter, TimeRange, ReplayControlMessage } from './types.js';
import { SnapshotManager } from './replay/snapshot-manager.js';
import { ReplayEngine } from './replay/replay-engine.js';
import { TimelineService } from './replay/timeline-service.js';
import { ReplaySession } from './replay/replay-session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export interface APIServerOptions {
  host: string;
  port: number;
  staticDir?: string;
}

interface WebSocketClient extends WebSocket {
  isAlive: boolean;
  filters?: {
    goalId?: string;
    types?: string[];
  };
  replaySession?: ReplaySession;
}

export class APIServer {
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private store: IDebugDataStore;
  private collector: EventCollector;
  private options: APIServerOptions;
  private clients = new Set<WebSocketClient>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private gatewayConnected = false;

  // Replay components
  private snapshotManager: SnapshotManager;
  private replayEngine: ReplayEngine;
  private timelineService: TimelineService;

  constructor(
    store: IDebugDataStore,
    collector: EventCollector,
    options: APIServerOptions
  ) {
    this.store = store;
    this.collector = collector;
    this.options = options;

    // Initialize replay components
    this.snapshotManager = new SnapshotManager(store);
    this.replayEngine = new ReplayEngine(store, this.snapshotManager);
    this.timelineService = new TimelineService(store);

    // Subscribe to events for real-time streaming
    this.collector.on('event', (event: EnrichedEvent) => {
      this.broadcastEvent(event);

      // Create snapshots for replay
      if (event.goalId && this.snapshotManager.shouldCreateSnapshot(event, event.goalId)) {
        this.createSnapshot(event.goalId, event).catch(console.error);
      }
    });
  }

  private async createSnapshot(goalId: string, triggerEvent: EnrichedEvent): Promise<void> {
    try {
      // Reconstruct current state
      const result = await this.replayEngine.reconstructState(goalId, Date.now());

      // Determine trigger type
      let triggerType: 'goal_start' | 'phase_transition' | 'error' | 'time_based' = 'time_based';
      if (triggerEvent.type === 'goal.created') {
        triggerType = 'goal_start';
      } else if (triggerEvent.type.includes('phase')) {
        triggerType = 'phase_transition';
      } else if (triggerEvent.type.includes('.error') || triggerEvent.type.includes('.failed')) {
        triggerType = 'error';
      }

      await this.snapshotManager.createSnapshot(
        goalId,
        result.state,
        triggerType,
        triggerEvent.id
      );
    } catch (error) {
      console.error('[APIServer] Failed to create snapshot:', error);
    }
  }

  /**
   * Start the API server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = createServer((req, res) => this.handleRequest(req, res));

        this.wss = new WebSocketServer({ server: this.server });
        this.wss.on('connection', (ws) => this.handleWebSocketConnection(ws as WebSocketClient));

        this.server.on('error', (error) => {
          console.error('[APIServer] Server error:', error);
          reject(error);
        });

        this.server.listen(this.options.port, this.options.host, () => {
          console.log(`[APIServer] Listening on http://${this.options.host}:${this.options.port}`);
          this.startHeartbeat();
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the API server.
   */
  async stop(): Promise<void> {
    this.stopHeartbeat();

    // Close all WebSocket connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close();
      }
      if (this.server) {
        this.server.close(() => {
          console.log('[APIServer] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Update Gateway connection status.
   */
  setGatewayConnected(connected: boolean): void {
    this.gatewayConnected = connected;
    this.broadcastStatus();
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (path.startsWith('/api/')) {
      this.handleAPIRequest(path, url, req, res);
      return;
    }

    // Static files
    this.handleStaticRequest(path, res);
  }

  private async handleAPIRequest(
    path: string,
    url: URL,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      let data: unknown;

      switch (path) {
        case '/api/health':
          data = {
            status: 'ok',
            gatewayConnected: this.gatewayConnected,
            eventCount: this.store.getEventCount(),
            timestamp: Date.now(),
          };
          break;

        case '/api/events':
          data = this.handleEventsQuery(url);
          break;

        case '/api/goals':
          data = this.handleGoalsQuery(url);
          break;

        case '/api/workitems':
          data = this.handleWorkItemsQuery(url);
          break;

        case '/api/runs':
          data = this.handleRunsQuery(url);
          break;

        case '/api/metrics':
          data = this.handleMetricsQuery(url);
          break;

        default:
          // Check for /api/goals/:id pattern
          if (path.startsWith('/api/goals/')) {
            const goalId = path.slice('/api/goals/'.length);
            data = this.handleGoalDetail(goalId);
          }
          // Check for replay API patterns
          else if (path.startsWith('/api/replay/')) {
            data = await this.handleReplayAPI(path, url);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      console.error('[APIServer] API error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private handleEventsQuery(url: URL): { events: EnrichedEvent[]; total: number } {
    const filter: EventFilter = {
      type: url.searchParams.get('type') || undefined,
      source: url.searchParams.get('source') || undefined,
      goalId: url.searchParams.get('goalId') || undefined,
      workItemId: url.searchParams.get('workItemId') || undefined,
      runId: url.searchParams.get('runId') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '100', 10),
      offset: parseInt(url.searchParams.get('offset') || '0', 10),
    };

    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    if (startTime) filter.startTime = parseInt(startTime, 10);
    if (endTime) filter.endTime = parseInt(endTime, 10);

    const events = this.store.queryEvents(filter);
    return {
      events,
      total: this.store.getEventCount(),
    };
  }

  private handleGoalsQuery(url: URL): { goals: unknown[] } {
    const filter: GoalFilter = {
      status: url.searchParams.get('status') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '100', 10),
      offset: parseInt(url.searchParams.get('offset') || '0', 10),
    };

    const goals = this.store.getGoals(filter);
    return { goals };
  }

  private handleGoalDetail(goalId: string): unknown {
    const goal = this.store.getGoal(goalId);
    if (!goal) {
      return { error: 'Goal not found' };
    }

    const workItems = this.store.getWorkItems(goalId);
    const events = this.store.queryEvents({ goalId, limit: 100 });

    return {
      goal,
      workItems,
      events,
    };
  }

  private handleWorkItemsQuery(url: URL): { workItems: unknown[] } {
    const goalId = url.searchParams.get('goalId') || undefined;
    const workItems = this.store.getWorkItems(goalId);
    return { workItems };
  }

  private handleRunsQuery(url: URL): { runs: unknown[] } {
    const workItemId = url.searchParams.get('workItemId') || undefined;
    const runs = this.store.getRuns(workItemId);
    return { runs };
  }

  private handleMetricsQuery(url: URL): { metrics: unknown[]; current: unknown } {
    const startTime = parseInt(url.searchParams.get('startTime') || '0', 10);
    const endTime = parseInt(url.searchParams.get('endTime') || String(Date.now()), 10);

    const timeRange: TimeRange = { start: startTime, end: endTime };
    const metrics = this.store.queryMetrics(timeRange);
    const current = this.collector.computeMetrics();

    return { metrics, current };
  }

  private async handleReplayAPI(path: string, url: URL): Promise<unknown> {
    // Parse path: /api/replay/:goalId/timeline or /api/replay/:goalId/state/:timestamp etc.
    const parts = path.split('/').filter(Boolean);

    if (parts.length < 3) {
      return { error: 'Invalid replay API path' };
    }

    const goalId = parts[2]; // parts = ['api', 'replay', goalId, ...]

    // /api/replay/:goalId/timeline
    if (parts[3] === 'timeline') {
      return await this.timelineService.getTimeline(goalId);
    }

    // /api/replay/:goalId/events
    if (parts[3] === 'events') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);

      const filter: EventFilter = {
        goalId,
        limit,
        startTime: from ? parseInt(from, 10) : undefined,
        endTime: to ? parseInt(to, 10) : undefined,
      };

      const events = this.store.queryEvents(filter);
      return { events, total: events.length };
    }

    // /api/replay/:goalId/state/:timestamp
    if (parts[3] === 'state' && parts[4]) {
      const timestamp = parseInt(parts[4], 10);
      return await this.replayEngine.reconstructState(goalId, timestamp);
    }

    // /api/replay/:goalId/diff/:eventId
    if (parts[3] === 'diff' && parts[4]) {
      const eventId = parts[4];
      return await this.replayEngine.computeEventDiff(eventId);
    }

    return { error: 'Unknown replay API endpoint' };
  }

  private handleStaticRequest(path: string, res: ServerResponse): void {
    // Default to index.html
    if (path === '/') {
      path = '/index.html';
    }

    const staticDir = resolve(this.options.staticDir || join(__dirname, 'static'));
    const filePath = resolve(staticDir, path.slice(1)); // Remove leading slash

    // Security: prevent directory traversal
    if (!filePath.startsWith(staticDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath)) {
      // For SPA, serve index.html for non-API routes
      // Try multiple locations for index.html (Next.js puts it in app/ subdirectory)
      const indexPaths = [
        resolve(staticDir, 'index.html'),
        resolve(staticDir, 'app/index.html'),
        resolve(staticDir, '../static/index.html'),
      ];

      for (const indexPath of indexPaths) {
        if (existsSync(indexPath)) {
          const content = readFileSync(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
          return;
        }
      }

      res.writeHead(404);
      res.end('Not found');
      return;
    }

    try {
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Internal server error');
    }
  }

  private handleWebSocketConnection(ws: WebSocketClient): void {
    ws.isAlive = true;
    this.clients.add(ws);

    console.log(`[APIServer] WebSocket client connected (total: ${this.clients.size})`);

    // Send initial status
    ws.send(JSON.stringify({
      type: 'status',
      data: {
        gatewayConnected: this.gatewayConnected,
        eventCount: this.store.getEventCount(),
        timestamp: Date.now(),
      },
    }));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(ws, message);
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      // Clean up replay session
      if (ws.replaySession) {
        ws.replaySession.stop();
        ws.replaySession = undefined;
      }

      this.clients.delete(ws);
      console.log(`[APIServer] WebSocket client disconnected (total: ${this.clients.size})`);
    });
  }

  private handleWebSocketMessage(ws: WebSocketClient, message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      return;
    }

    const msg = message as Record<string, unknown>;

    // Handle subscription filters
    if (msg.type === 'subscribe') {
      ws.filters = {
        goalId: msg.goalId as string | undefined,
        types: msg.types as string[] | undefined,
      };
      return;
    }

    // Handle replay control messages
    if (msg.type && (msg.type as string).startsWith('replay.')) {
      this.handleReplayControl(ws, msg as ReplayControlMessage);
    }
  }

  private async handleReplayControl(ws: WebSocketClient, msg: ReplayControlMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'replay.start': {
          // Stop existing session if any
          if (ws.replaySession) {
            ws.replaySession.stop();
          }

          // Create new replay session
          ws.replaySession = new ReplaySession(
            msg.goalId,
            this.replayEngine,
            this.store,
            ws,
            { speed: msg.speed }
          );

          await ws.replaySession.start();
          break;
        }

        case 'replay.pause':
          ws.replaySession?.pause();
          break;

        case 'replay.resume':
          ws.replaySession?.resume();
          break;

        case 'replay.seek':
          await ws.replaySession?.seek(msg.timestamp);
          break;

        case 'replay.step':
          await ws.replaySession?.step(msg.direction);
          break;

        case 'replay.speed':
          ws.replaySession?.setSpeed(msg.speed);
          break;

        case 'replay.stop':
          ws.replaySession?.stop();
          ws.replaySession = undefined;
          break;
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'replay.error',
        error: (error as Error).message,
      }));
    }
  }

  private broadcastEvent(event: EnrichedEvent): void {
    const message = JSON.stringify({
      type: 'event',
      data: event,
    });

    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      // Apply filters
      if (client.filters) {
        if (client.filters.goalId && event.goalId !== client.filters.goalId) {
          continue;
        }
        if (client.filters.types && !client.filters.types.some((t) => event.type.startsWith(t))) {
          continue;
        }
      }

      client.send(message);
    }
  }

  private broadcastStatus(): void {
    const message = JSON.stringify({
      type: 'status',
      data: {
        gatewayConnected: this.gatewayConnected,
        eventCount: this.store.getEventCount(),
        timestamp: Date.now(),
      },
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
