/**
 * Frontend API Client
 * Communicates with Next.js API routes instead of directly with Gateway
 */

import type {
  Goal,
  WorkItem,
  Escalation,
  ConversationMessageParams,
  ConversationMessageResult,
  ConversationTurn,
  PersonaSummary,
  Persona,
  ConversationState,
} from './types';

class ApiClient {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>();

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  // ============================================================================
  // HTTP Methods
  // ============================================================================

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }

    return response.json();
  }

  // ============================================================================
  // Gateway Status
  // ============================================================================

  async getStatus(): Promise<{ connected: boolean; error?: string }> {
    return this.fetch('/api/gateway/status');
  }

  // ============================================================================
  // Conversation (Primary API for UI)
  // ============================================================================

  async sendMessage(params: ConversationMessageParams): Promise<ConversationMessageResult> {
    return this.fetch('/api/conversation', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getConversationHistory(sessionId: string, limit?: number): Promise<{ turns: ConversationTurn[] }> {
    const searchParams = new URLSearchParams();
    searchParams.set('sessionId', sessionId);
    if (limit) searchParams.set('limit', limit.toString());
    return this.fetch(`/api/conversation?${searchParams.toString()}`);
  }

  async endConversation(sessionId: string): Promise<{ success: boolean }> {
    return this.fetch('/api/conversation', {
      method: 'DELETE',
      body: JSON.stringify({ sessionId }),
    });
  }

  async listPersonas(): Promise<{ personas: PersonaSummary[] }> {
    return this.fetch('/api/personas');
  }

  async getPersona(id: string): Promise<Persona> {
    return this.fetch(`/api/personas/${id}`);
  }

  // ============================================================================
  // Goals
  // ============================================================================

  async listGoals(params?: { status?: string; limit?: number; offset?: number }): Promise<{ goals: Goal[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    return this.fetch(`/api/goals${query ? `?${query}` : ''}`);
  }

  async submitGoal(description: string, context?: Record<string, unknown>): Promise<Goal> {
    return this.fetch('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ description, context }),
    });
  }

  async getGoal(goalId: string): Promise<Goal> {
    return this.fetch(`/api/goals/${goalId}`);
  }

  async cancelGoal(goalId: string): Promise<void> {
    await this.fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
  }

  async getWorkItems(goalId: string): Promise<{ workItems: WorkItem[] }> {
    return this.fetch(`/api/goals/${goalId}/workitems`);
  }

  // ============================================================================
  // Escalations
  // ============================================================================

  async listEscalations(params?: { goalId?: string; status?: string }): Promise<{ escalations: Escalation[] }> {
    const searchParams = new URLSearchParams();
    if (params?.goalId) searchParams.set('goalId', params.goalId);
    if (params?.status) searchParams.set('status', params.status);

    const query = searchParams.toString();
    return this.fetch(`/api/escalations${query ? `?${query}` : ''}`);
  }

  async respondToEscalation(escalationId: string, action: string, data?: Record<string, unknown>): Promise<void> {
    await this.fetch(`/api/escalations/${escalationId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, data }),
    });
  }

  // ============================================================================
  // Server-Sent Events
  // ============================================================================

  connectEvents(): void {
    if (this.eventSource) {
      return;
    }

    this.eventSource = new EventSource(`${this.baseUrl}/api/events`);

    this.eventSource.onopen = () => {
      console.log('[ApiClient] SSE connected');
    };

    this.eventSource.onerror = (error) => {
      console.error('[ApiClient] SSE error:', error);
      // EventSource will auto-reconnect
    };

    // Handle all event types
    this.eventSource.onmessage = (event) => {
      this.dispatchEvent('message', JSON.parse(event.data));
    };

    // Handle specific event types
    const eventTypes = [
      'connected',
      'heartbeat',
      'goal.created',
      'goal.updated',
      'goal.completed',
      'goal.cancelled',
      'workitem.created',
      'workitem.updated',
      'workitem.completed',
      'workitem.failed',
      'escalation.created',
      'escalation.resolved',
      'llm.stream.start',
      'llm.stream.chunk',
      'llm.stream.end',
      'llm.stream.error',
    ];

    eventTypes.forEach((eventType) => {
      this.eventSource!.addEventListener(eventType, (event) => {
        const data = JSON.parse((event as MessageEvent).data);
        this.dispatchEvent(eventType, data);
      });
    });
  }

  disconnectEvents(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  private dispatchEvent(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }

    // Also dispatch to wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler({ event, data }));
    }
  }
}

// Singleton instance
export const apiClient = new ApiClient();
