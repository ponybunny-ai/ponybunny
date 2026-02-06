/**
 * Debug event emitter singleton.
 * Provides the core event emission mechanism for the instrumentation system.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { DebugEvent, DebugContext } from './types.js';

/**
 * DebugEmitter is a singleton that manages debug event emission.
 * It can be enabled/disabled and maintains context for event correlation.
 */
class DebugEmitter extends EventEmitter {
  private _enabled = false;
  private context: DebugContext = {};

  /**
   * Enable debug mode. Events will only be emitted when enabled.
   */
  enable(): void {
    this._enabled = true;
  }

  /**
   * Disable debug mode. Events will not be emitted when disabled.
   */
  disable(): void {
    this._enabled = false;
  }

  /**
   * Check if debug mode is enabled.
   */
  isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Set the current context for event correlation.
   * Context fields are automatically added to all emitted events.
   * @param ctx - Context to merge with existing context
   */
  setContext(ctx: DebugContext): void {
    this.context = { ...this.context, ...ctx };
  }

  /**
   * Get the current context.
   */
  getContext(): DebugContext {
    return { ...this.context };
  }

  /**
   * Clear the current context.
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Emit a debug event.
   * @param type - Event type in format "domain.action"
   * @param source - Source module identifier
   * @param data - Event-specific data payload
   * @returns true if event was emitted, false if debug is disabled
   */
  emitDebug(type: string, source: string, data: Record<string, unknown>): boolean {
    if (!this._enabled) {
      return false;
    }

    const event: DebugEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      type,
      source,
      data,
      ...(this.context.goalId && { goalId: this.context.goalId }),
      ...(this.context.workItemId && { workItemId: this.context.workItemId }),
      ...(this.context.runId && { runId: this.context.runId }),
    };

    return super.emit('debug', event);
  }

  /**
   * Subscribe to debug events.
   * @param handler - Event handler function
   */
  onDebug(handler: (event: DebugEvent) => void): void {
    this.on('debug', handler);
  }

  /**
   * Unsubscribe from debug events.
   * @param handler - Event handler function to remove
   */
  offDebug(handler: (event: DebugEvent) => void): void {
    this.off('debug', handler);
  }
}

// Singleton instance
export const debugEmitter = new DebugEmitter();
