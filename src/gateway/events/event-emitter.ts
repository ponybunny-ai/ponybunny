/**
 * Event Emitter - Emits events to connected clients
 */

import type { EventFrame, GatewayEventType } from '../types.js';
import type { ConnectionManager } from '../connection/connection-manager.js';
import type { Session } from '../connection/session.js';

export class EventEmitter {
  private connectionManager: ConnectionManager;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  /**
   * Emit an event to all connected clients
   */
  broadcast(event: GatewayEventType, data: unknown): number {
    const frame = this.createEventFrame(event, data);
    return this.connectionManager.broadcast(frame);
  }

  /**
   * Emit an event to clients with specific permission
   */
  broadcastToPermission(event: GatewayEventType, data: unknown, permission: 'read' | 'write' | 'admin'): number {
    const frame = this.createEventFrame(event, data);
    return this.connectionManager.broadcast(frame, (session) => session.hasPermission(permission));
  }

  /**
   * Emit an event to clients subscribed to a specific goal
   */
  emitToGoalSubscribers(goalId: string, event: GatewayEventType, data: unknown): number {
    const frame = this.createEventFrame(event, data);
    const subscribers = this.connectionManager.getSessionsSubscribedToGoal(goalId);

    let sent = 0;
    for (const session of subscribers) {
      if (this.connectionManager.sendToSession(session.id, frame)) {
        sent++;
      }
    }
    return sent;
  }

  /**
   * Emit an event to a specific session
   */
  emitToSession(sessionId: string, event: GatewayEventType, data: unknown): boolean {
    const frame = this.createEventFrame(event, data);
    return this.connectionManager.sendToSession(sessionId, frame);
  }

  /**
   * Emit an event to sessions matching a filter
   */
  emitToFiltered(
    event: GatewayEventType,
    data: unknown,
    filter: (session: Session) => boolean
  ): number {
    const frame = this.createEventFrame(event, data);
    return this.connectionManager.broadcast(frame, filter);
  }

  private createEventFrame(event: GatewayEventType, data: unknown): EventFrame {
    return {
      type: 'event',
      event,
      data: {
        ...((typeof data === 'object' && data !== null) ? data : { value: data }),
        timestamp: Date.now(),
      },
    };
  }
}
