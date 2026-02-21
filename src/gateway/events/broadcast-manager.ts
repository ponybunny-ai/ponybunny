/**
 * Broadcast Manager - Manages event subscriptions and broadcasts
 */

import type { GatewayEventType } from '../types.js';
import type { EventBus } from './event-bus.js';
import { EventEmitter } from './event-emitter.js';

export class BroadcastManager {
  private eventBus: EventBus;
  private eventEmitter: EventEmitter;
  private unsubscribers: Array<() => void> = [];

  constructor(eventBus: EventBus, eventEmitter: EventEmitter) {
    this.eventBus = eventBus;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start listening to internal events and broadcasting to clients
   */
  start(): void {
    // Goal events
    this.subscribeAndBroadcast('goal.created', 'goal.created');
    this.subscribeAndBroadcast('goal.started', 'goal.started');
    this.subscribeAndBroadcast('goal.updated', 'goal.updated');
    this.subscribeAndBroadcast('goal.completed', 'goal.completed');
    this.subscribeAndBroadcast('goal.failed', 'goal.failed');
    this.subscribeAndBroadcast('goal.cancelled', 'goal.cancelled');

    // Work item events
    this.subscribeAndBroadcast('workitem.created', 'workitem.created');
    this.subscribeAndBroadcast('workitem.started', 'workitem.started');
    this.subscribeAndBroadcast('workitem.updated', 'workitem.updated');
    this.subscribeAndBroadcast('workitem.completed', 'workitem.completed');
    this.subscribeAndBroadcast('workitem.failed', 'workitem.failed');

    // Run events
    this.subscribeAndBroadcast('run.started', 'run.started');
    this.subscribeAndBroadcast('run.completed', 'run.completed');

    // Escalation events
    this.subscribeAndBroadcast('escalation.created', 'escalation.created');
    this.subscribeAndBroadcast('escalation.resolved', 'escalation.resolved');

    // LLM streaming events
    this.subscribeAndBroadcast('llm.stream.start', 'llm.stream.start');
    this.subscribeAndBroadcast('llm.stream.chunk', 'llm.stream.chunk');
    this.subscribeAndBroadcast('llm.stream.end', 'llm.stream.end');
    this.subscribeAndBroadcast('llm.stream.error', 'llm.stream.error');
  }

  /**
   * Stop broadcasting
   */
  stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  private subscribeAndBroadcast(internalEvent: string, clientEvent: GatewayEventType): void {
    const unsubscribe = this.eventBus.on(internalEvent, (data: unknown) => {
      this.broadcastEvent(clientEvent, data);
    });
    this.unsubscribers.push(unsubscribe);
  }

  private broadcastEvent(event: GatewayEventType, data: unknown): void {
    // Extract goalId from data if present for targeted broadcasting
    const goalId = this.extractGoalId(data);

    if (goalId) {
      // Broadcast to goal subscribers
      const sent = this.eventEmitter.emitToGoalSubscribers(goalId, event, data);
      console.log(`[BroadcastManager] Sent ${event} to ${sent} subscribers of goal ${goalId}`);
    } else {
      // Broadcast to all clients with read permission
      const sent = this.eventEmitter.broadcastToPermission(event, data, 'read');
      console.log(`[BroadcastManager] Broadcast ${event} to ${sent} clients`);
    }
  }

  private extractGoalId(data: unknown): string | undefined {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.goalId === 'string') {
        return obj.goalId;
      }
      if (typeof obj.goal_id === 'string') {
        return obj.goal_id;
      }
    }
    return undefined;
  }
}
