/**
 * Abort Manager
 *
 * Manages abort signals and their propagation through the execution chain.
 * Supports hierarchical cancellation (goal -> work_item -> run).
 */

import type {
  IAbortManager,
  IAbortRegistration,
  IAbortContext,
  IAbortEvent,
  IAbortStats,
  AbortScope,
  AbortEventHandler,
} from '../../domain/abort/types.js';

// ============================================================================
// Abort Manager Implementation
// ============================================================================

export class AbortManager implements IAbortManager {
  private registrations = new Map<string, IAbortRegistration>();
  private abortContexts = new Map<string, IAbortContext>();
  private eventHandlers: AbortEventHandler[] = [];
  private stats: IAbortStats = {
    totalRegistered: 0,
    totalAborted: 0,
    activeRegistrations: 0,
    byScope: { goal: 0, work_item: 0, run: 0 },
  };

  /**
   * Generate a unique key for a registration
   */
  private getKey(scope: AbortScope, id: string): string {
    return `${scope}:${id}`;
  }

  /**
   * Register a new abort controller for a scope
   */
  register(
    scope: AbortScope,
    id: string,
    options: {
      parentId?: string;
      timeout?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): AbortSignal {
    const key = this.getKey(scope, id);

    // Check if already registered
    const existing = this.registrations.get(key);
    if (existing) {
      return existing.controller.signal;
    }

    const controller = new AbortController();

    const registration: IAbortRegistration = {
      id,
      scope,
      parentId: options.parentId,
      controller,
      createdAt: Date.now(),
      timeout: options.timeout,
      metadata: options.metadata,
    };

    // Set up timeout if specified
    if (options.timeout && options.timeout > 0) {
      registration.timeoutId = setTimeout(() => {
        this.abort(scope, id, 'Timeout exceeded', 'system');
        this.emitEvent({
          type: 'abort_timeout',
          scope,
          id,
          reason: `Timeout after ${options.timeout}ms`,
          timestamp: Date.now(),
        });
      }, options.timeout);
    }

    // Note: Parent-child cascade is handled explicitly in abort() method
    // rather than through signal event listeners, to ensure proper counting
    // and control over the cascade process.

    this.registrations.set(key, registration);
    this.stats.totalRegistered++;
    this.stats.activeRegistrations++;
    this.stats.byScope[scope]++;

    return controller.signal;
  }

  /**
   * Get the parent key based on scope hierarchy
   */
  private getParentKey(scope: AbortScope, parentId: string): string {
    switch (scope) {
      case 'run':
        return `work_item:${parentId}`;
      case 'work_item':
        return `goal:${parentId}`;
      default:
        return `goal:${parentId}`;
    }
  }

  /**
   * Get the abort signal for a scope
   */
  getSignal(scope: AbortScope, id: string): AbortSignal | undefined {
    const key = this.getKey(scope, id);
    return this.registrations.get(key)?.controller.signal;
  }

  /**
   * Check if an abort has been requested
   */
  isAborted(scope: AbortScope, id: string): boolean {
    const key = this.getKey(scope, id);
    const reg = this.registrations.get(key);
    return reg?.controller.signal.aborted ?? false;
  }

  /**
   * Abort a specific scope (and cascade to children)
   */
  abort(
    scope: AbortScope,
    id: string,
    reason: string,
    abortedBy?: string
  ): number {
    const key = this.getKey(scope, id);
    const reg = this.registrations.get(key);

    if (!reg) {
      return 0;
    }

    let abortedCount = 0;

    // Abort this registration
    if (!reg.controller.signal.aborted) {
      // Clear timeout if set
      if (reg.timeoutId) {
        clearTimeout(reg.timeoutId);
      }

      reg.controller.abort(reason);
      abortedCount = 1;

      // Store abort context
      this.abortContexts.set(key, {
        scope,
        id,
        parentId: reg.parentId,
        reason,
        abortedAt: Date.now(),
        abortedBy,
      });

      this.stats.totalAborted++;

      // Emit abort event
      this.emitEvent({
        type: 'abort_requested',
        scope,
        id,
        reason,
        timestamp: Date.now(),
        abortedBy,
      });
    }

    // Cascade to children
    const childScope = this.getChildScope(scope);
    if (childScope) {
      const childCount = this.abortChildren(scope, id, reason, abortedBy);
      abortedCount += childCount;

      if (childCount > 0) {
        this.emitEvent({
          type: 'abort_cascade',
          scope,
          id,
          reason,
          timestamp: Date.now(),
          childIds: this.getChildIds(scope, id),
        });
      }
    }

    return abortedCount;
  }

  /**
   * Get the child scope for cascading
   */
  private getChildScope(scope: AbortScope): AbortScope | undefined {
    switch (scope) {
      case 'goal':
        return 'work_item';
      case 'work_item':
        return 'run';
      default:
        return undefined;
    }
  }

  /**
   * Get child IDs for a parent
   */
  private getChildIds(parentScope: AbortScope, parentId: string): string[] {
    const childScope = this.getChildScope(parentScope);
    if (!childScope) return [];

    const childIds: string[] = [];
    for (const [key, reg] of this.registrations) {
      if (reg.scope === childScope && reg.parentId === parentId) {
        childIds.push(reg.id);
      }
    }
    return childIds;
  }

  /**
   * Abort all children of a parent
   */
  abortChildren(
    parentScope: AbortScope,
    parentId: string,
    reason: string,
    abortedBy?: string
  ): number {
    const childScope = this.getChildScope(parentScope);
    if (!childScope) return 0;

    let abortedCount = 0;

    for (const [key, reg] of this.registrations) {
      if (reg.scope === childScope && reg.parentId === parentId) {
        abortedCount += this.abort(childScope, reg.id, reason, abortedBy);
      }
    }

    return abortedCount;
  }

  /**
   * Unregister an abort controller (cleanup)
   */
  unregister(scope: AbortScope, id: string): boolean {
    const key = this.getKey(scope, id);
    const reg = this.registrations.get(key);

    if (!reg) {
      return false;
    }

    // Clear timeout if set
    if (reg.timeoutId) {
      clearTimeout(reg.timeoutId);
    }

    this.registrations.delete(key);
    this.stats.activeRegistrations--;
    this.stats.byScope[scope]--;

    return true;
  }

  /**
   * Unregister all controllers for a parent
   */
  unregisterChildren(parentScope: AbortScope, parentId: string): number {
    const childScope = this.getChildScope(parentScope);
    if (!childScope) return 0;

    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key, reg] of this.registrations) {
      if (reg.scope === childScope && reg.parentId === parentId) {
        if (reg.timeoutId) {
          clearTimeout(reg.timeoutId);
        }
        keysToDelete.push(key);
        count++;
      }
    }

    for (const key of keysToDelete) {
      const reg = this.registrations.get(key);
      if (reg) {
        this.stats.activeRegistrations--;
        this.stats.byScope[reg.scope]--;
      }
      this.registrations.delete(key);
    }

    return count;
  }

  /**
   * Get all active abort registrations
   */
  getActiveRegistrations(scope?: AbortScope): IAbortRegistration[] {
    const registrations: IAbortRegistration[] = [];

    for (const reg of this.registrations.values()) {
      if (!scope || reg.scope === scope) {
        if (!reg.controller.signal.aborted) {
          registrations.push(reg);
        }
      }
    }

    return registrations;
  }

  /**
   * Get abort context (history)
   */
  getAbortContext(scope: AbortScope, id: string): IAbortContext | undefined {
    const key = this.getKey(scope, id);
    return this.abortContexts.get(key);
  }

  /**
   * Register an event handler
   */
  onAbort(handler: AbortEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove an event handler
   */
  offAbort(handler: AbortEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Emit an abort event
   */
  private async emitEvent(event: IAbortEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error('Error in abort event handler:', error);
      }
    }
  }

  /**
   * Clear all registrations (for cleanup)
   */
  clear(): void {
    // Clear all timeouts
    for (const reg of this.registrations.values()) {
      if (reg.timeoutId) {
        clearTimeout(reg.timeoutId);
      }
    }

    this.registrations.clear();
    this.abortContexts.clear();
    this.stats = {
      totalRegistered: 0,
      totalAborted: 0,
      activeRegistrations: 0,
      byScope: { goal: 0, work_item: 0, run: 0 },
    };
  }

  /**
   * Get statistics
   */
  getStats(): IAbortStats {
    return { ...this.stats };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create an abortable promise that rejects when signal is aborted
 */
export function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    // Check if already aborted
    if (signal.aborted) {
      reject(new DOMException('Operation was aborted', 'AbortError'));
      return;
    }

    // Listen for abort
    const abortHandler = () => {
      reject(new DOMException(signal.reason || 'Operation was aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abortHandler, { once: true });

    // Handle promise resolution
    promise
      .then((value) => {
        signal.removeEventListener('abort', abortHandler);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener('abort', abortHandler);
        reject(error);
      });
  });
}

/**
 * Create an abortable timeout
 */
export function abortableTimeout(
  ms: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Operation was aborted', 'AbortError'));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);

    const abortHandler = () => {
      clearTimeout(timeoutId);
      reject(new DOMException(signal.reason || 'Operation was aborted', 'AbortError'));
    };

    signal.addEventListener('abort', abortHandler, { once: true });
  });
}

/**
 * Check if an error is an abort error
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.message.includes('aborted')
  );
}

/**
 * Run a function with abort signal, with cleanup on abort
 */
export async function runWithAbort<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  cleanup?: () => Promise<void>
): Promise<T> {
  try {
    return await withAbortSignal(fn(signal), signal);
  } catch (error) {
    if (isAbortError(error) && cleanup) {
      await cleanup();
    }
    throw error;
  }
}
