import type {
  DebugEvent,
  CachedGoal,
  CachedWorkItem,
  CachedRun,
  AggregatedMetrics,
  EventFilter,
  GoalFilter,
  TimeRange,
  HealthStatus,
  EventsResponse,
  GoalsResponse,
  GoalDetailResponse,
  WorkItemsResponse,
  RunsResponse,
  MetricsResponse,
  TimelineMetadata,
  ReplayState,
  StateDiff,
  ReplayEventData,
} from './types.js';

type EventHandler = (data: unknown) => void;

class DebugApiClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(baseUrl: string = 'http://localhost:18790') {
    this.baseUrl = baseUrl;
  }

  // REST API Methods
  async getHealth(): Promise<HealthStatus> {
    const response = await fetch(`${this.baseUrl}/api/health`);
    if (!response.ok) throw new Error('Failed to fetch health status');
    return response.json();
  }

  async getEvents(filter?: EventFilter): Promise<EventsResponse> {
    const params = new URLSearchParams();
    if (filter?.types) params.append('types', filter.types.join(','));
    if (filter?.sources) params.append('sources', filter.sources.join(','));
    if (filter?.goalId) params.append('goalId', filter.goalId);
    if (filter?.workItemId) params.append('workItemId', filter.workItemId);
    if (filter?.runId) params.append('runId', filter.runId);
    if (filter?.startTime) params.append('startTime', filter.startTime.toString());
    if (filter?.endTime) params.append('endTime', filter.endTime.toString());
    if (filter?.limit) params.append('limit', filter.limit.toString());
    if (filter?.offset) params.append('offset', filter.offset.toString());

    const response = await fetch(`${this.baseUrl}/api/events?${params}`);
    if (!response.ok) throw new Error('Failed to fetch events');
    return response.json();
  }

  async getGoals(filter?: GoalFilter): Promise<GoalsResponse> {
    const params = new URLSearchParams();
    if (filter?.status) params.append('status', filter.status.join(','));
    if (filter?.limit) params.append('limit', filter.limit.toString());
    if (filter?.offset) params.append('offset', filter.offset.toString());

    const response = await fetch(`${this.baseUrl}/api/goals?${params}`);
    if (!response.ok) throw new Error('Failed to fetch goals');
    return response.json();
  }

  async getGoal(id: string): Promise<GoalDetailResponse> {
    const response = await fetch(`${this.baseUrl}/api/goals/${id}`);
    if (!response.ok) throw new Error('Failed to fetch goal');
    return response.json();
  }

  async getWorkItems(goalId?: string): Promise<WorkItemsResponse> {
    const params = goalId ? `?goalId=${goalId}` : '';
    const response = await fetch(`${this.baseUrl}/api/workitems${params}`);
    if (!response.ok) throw new Error('Failed to fetch work items');
    return response.json();
  }

  async getRuns(workItemId?: string): Promise<RunsResponse> {
    const params = workItemId ? `?workItemId=${workItemId}` : '';
    const response = await fetch(`${this.baseUrl}/api/runs${params}`);
    if (!response.ok) throw new Error('Failed to fetch runs');
    return response.json();
  }

  async getMetrics(timeRange?: TimeRange): Promise<MetricsResponse> {
    const params = new URLSearchParams();
    if (timeRange?.start) params.append('start', timeRange.start.toString());
    if (timeRange?.end) params.append('end', timeRange.end.toString());
    if (timeRange?.interval) params.append('interval', timeRange.interval.toString());

    const response = await fetch(`${this.baseUrl}/api/metrics?${params}`);
    if (!response.ok) throw new Error('Failed to fetch metrics');
    return response.json();
  }

  // WebSocket Methods
  connectWebSocket(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    this.ws = new WebSocket(`${wsUrl}/ws`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.emit('connected', {});
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.emit(message.type, message.data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.emit('disconnected', {});
      this.scheduleReconnect();
    };
  }

  disconnectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
      this.connectWebSocket();
    }, delay);
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.eventHandlers.delete(event);
        }
      }
    };
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  subscribe(filters?: { goalId?: string; types?: string[] }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', filters }));
    }
  }

  unsubscribe(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe' }));
    }
  }

  // Replay API Methods
  async getTimeline(goalId: string): Promise<TimelineMetadata> {
    const response = await fetch(`${this.baseUrl}/api/replay/${goalId}/timeline`);
    if (!response.ok) throw new Error('Failed to fetch timeline');
    return response.json();
  }

  async getReplayEvents(goalId: string, from?: number, to?: number, limit = 100): Promise<EventsResponse> {
    const params = new URLSearchParams();
    if (from) params.append('from', from.toString());
    if (to) params.append('to', to.toString());
    params.append('limit', limit.toString());

    const response = await fetch(`${this.baseUrl}/api/replay/${goalId}/events?${params}`);
    if (!response.ok) throw new Error('Failed to fetch replay events');
    return response.json();
  }

  async getStateAtTimestamp(goalId: string, timestamp: number): Promise<ReplayState> {
    const response = await fetch(`${this.baseUrl}/api/replay/${goalId}/state/${timestamp}`);
    if (!response.ok) throw new Error('Failed to fetch state');
    return response.json();
  }

  async getEventDiff(goalId: string, eventId: string): Promise<StateDiff> {
    const response = await fetch(`${this.baseUrl}/api/replay/${goalId}/diff/${eventId}`);
    if (!response.ok) throw new Error('Failed to fetch diff');
    return response.json();
  }

  // Replay Control via WebSocket
  startReplay(goalId: string, speed = 1): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.start', goalId, speed }));
    }
  }

  pauseReplay(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.pause' }));
    }
  }

  resumeReplay(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.resume' }));
    }
  }

  seekReplay(timestamp: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.seek', timestamp }));
    }
  }

  stepReplay(direction: 'forward' | 'backward'): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.step', direction }));
    }
  }

  setReplaySpeed(speed: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.speed', speed }));
    }
  }

  stopReplay(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'replay.stop' }));
    }
  }
}

export const debugApiClient = new DebugApiClient();
