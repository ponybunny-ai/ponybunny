/**
 * Broadcast Manager - Manages event subscriptions and broadcasts
 */

import type { GatewayEventType } from '../types.js';
import type { EventBus } from './event-bus.js';
import { EventEmitter } from './event-emitter.js';
import type { ChannelRouter } from '../channels/channel-router.js';

export class BroadcastManager {
  private eventBus: EventBus;
  private eventEmitter: EventEmitter;
  private channelRouter: ChannelRouter;
  private unsubscribers: Array<() => void> = [];

  constructor(eventBus: EventBus, eventEmitter: EventEmitter, channelRouter: ChannelRouter) {
    this.eventBus = eventBus;
    this.eventEmitter = eventEmitter;
    this.channelRouter = channelRouter;
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
    this.subscribeAndBroadcast('goal.deleted', 'goal.deleted');

    // Work item events
    this.subscribeAndBroadcast('workitem.created', 'workitem.created');
    this.subscribeAndBroadcast('workitem.started', 'workitem.started');
    this.subscribeAndBroadcast('workitem.in_progress', 'workitem.in_progress');
    this.subscribeAndBroadcast('workitem.ended', 'workitem.ended');
    this.subscribeAndBroadcast('workitem.updated', 'workitem.updated');
    this.subscribeAndBroadcast('workitem.completed', 'workitem.completed');
    this.subscribeAndBroadcast('workitem.failed', 'workitem.failed');

    // Run events
    this.subscribeAndBroadcast('run.started', 'run.started');
    this.subscribeAndBroadcast('run.completed', 'run.completed');

    this.subscribeAndBroadcast('verification.started', 'verification.started');
    this.subscribeAndBroadcast('verification.completed', 'verification.completed');
    this.subscribeAndBroadcast('budget.warning', 'budget.warning');
    this.subscribeAndBroadcast('budget.exceeded', 'budget.exceeded');

    // Escalation events
    this.subscribeAndBroadcast('escalation.created', 'escalation.created');
    this.subscribeAndBroadcast('escalation.resolved', 'escalation.resolved');

    // LLM streaming events
    this.subscribeAndBroadcast('llm.stream.start', 'llm.stream.start');
    this.subscribeAndBroadcast('llm.stream.chunk', 'llm.stream.chunk');
    this.subscribeAndBroadcast('llm.stream.end', 'llm.stream.end');
    this.subscribeAndBroadcast('llm.stream.error', 'llm.stream.error');

    this.subscribeAndBroadcast('conversation.new', 'conversation.new');
    this.subscribeAndBroadcast('conversation.message.started', 'conversation.message.started');
    this.subscribeAndBroadcast('conversation.message.succeeded', 'conversation.message.succeeded');
    this.subscribeAndBroadcast('conversation.response', 'conversation.response');
    this.subscribeAndBroadcast('conversation.ended', 'conversation.ended');
    this.subscribeAndBroadcast('conversation.archived', 'conversation.archived');
    this.subscribeAndBroadcast('conversation.resumed', 'conversation.resumed');

    this.subscribeAndBroadcast('channel.adapter.config.updated', 'channel.adapter.config.updated');
    this.subscribeAndBroadcast('channel.adapter.status.updated', 'channel.adapter.status.updated');
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
    const gatewaySessionId = this.extractGatewaySessionId(data);
    if (gatewaySessionId) {
      const sent = this.eventEmitter.emitToSession(gatewaySessionId, event, data) ? 1 : 0;
      console.log(`[BroadcastManager] Sent ${event} to session ${gatewaySessionId} (${sent})`);
      return;
    }

    // Extract goalId from data if present for targeted broadcasting
    const goalId = this.extractGoalId(data);

    if (goalId) {
      // Broadcast to goal subscribers
      const sent = this.eventEmitter.emitToGoalSubscribers(goalId, event, data);
      console.log(`[BroadcastManager] Sent ${event} to ${sent} subscribers of goal ${goalId}`);
    } else {
      const channelFilter = this.channelRouter.buildSessionFilter(data);
      const sent = this.eventEmitter.emitToFiltered(
        event,
        data,
        (session) => session.hasPermission('read') && channelFilter(session)
      );
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

  private extractGatewaySessionId(data: unknown): string | undefined {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.gatewaySessionId === 'string') {
        return obj.gatewaySessionId;
      }
    }
    return undefined;
  }
}
