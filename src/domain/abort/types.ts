/**
 * Abort Signal Types
 *
 * Types for managing abort signals and cancellation propagation
 * throughout the execution chain (goal -> work item -> run).
 */

// ============================================================================
// Abort Scope Types
// ============================================================================

export type AbortScope = 'goal' | 'work_item' | 'run';

export interface IAbortContext {
  scope: AbortScope;
  id: string;
  parentId?: string;
  reason?: string;
  abortedAt?: number;
  abortedBy?: string;
}

// ============================================================================
// Abort Registration
// ============================================================================

export interface IAbortRegistration {
  id: string;
  scope: AbortScope;
  parentId?: string;
  controller: AbortController;
  createdAt: number;
  timeout?: number;
  timeoutId?: ReturnType<typeof setTimeout>;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Abort Event Types
// ============================================================================

export interface IAbortEvent {
  type: 'abort_requested' | 'abort_completed' | 'abort_timeout' | 'abort_cascade';
  scope: AbortScope;
  id: string;
  reason: string;
  timestamp: number;
  parentId?: string;
  childIds?: string[];
  abortedBy?: string;
}

export type AbortEventHandler = (event: IAbortEvent) => void | Promise<void>;

// ============================================================================
// Abort Manager Interface
// ============================================================================

export interface IAbortManager {
  /**
   * Register a new abort controller for a scope
   */
  register(
    scope: AbortScope,
    id: string,
    options?: {
      parentId?: string;
      timeout?: number;
      metadata?: Record<string, unknown>;
    }
  ): AbortSignal;

  /**
   * Get the abort signal for a scope
   */
  getSignal(scope: AbortScope, id: string): AbortSignal | undefined;

  /**
   * Check if an abort has been requested
   */
  isAborted(scope: AbortScope, id: string): boolean;

  /**
   * Abort a specific scope (and cascade to children)
   */
  abort(
    scope: AbortScope,
    id: string,
    reason: string,
    abortedBy?: string
  ): number; // Returns number of aborted items

  /**
   * Abort all children of a parent
   */
  abortChildren(
    parentScope: AbortScope,
    parentId: string,
    reason: string,
    abortedBy?: string
  ): number;

  /**
   * Unregister an abort controller (cleanup)
   */
  unregister(scope: AbortScope, id: string): boolean;

  /**
   * Unregister all controllers for a parent
   */
  unregisterChildren(parentScope: AbortScope, parentId: string): number;

  /**
   * Get all active abort registrations
   */
  getActiveRegistrations(scope?: AbortScope): IAbortRegistration[];

  /**
   * Get abort context (history)
   */
  getAbortContext(scope: AbortScope, id: string): IAbortContext | undefined;

  /**
   * Register an event handler
   */
  onAbort(handler: AbortEventHandler): void;

  /**
   * Remove an event handler
   */
  offAbort(handler: AbortEventHandler): void;

  /**
   * Clear all registrations (for cleanup)
   */
  clear(): void;
}

// ============================================================================
// Abortable Operation Interface
// ============================================================================

/**
 * Interface for operations that support abortion
 */
export interface IAbortableOperation<T> {
  /**
   * Execute the operation with abort support
   */
  execute(signal: AbortSignal): Promise<T>;

  /**
   * Cleanup after abort (optional)
   */
  cleanup?(): Promise<void>;
}

/**
 * Result of an abortable operation
 */
export type AbortableResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'aborted'; reason: string }
  | { status: 'timeout'; elapsed: number }
  | { status: 'error'; error: Error };

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Options for creating an abort-aware promise
 */
export interface IAbortablePromiseOptions {
  signal: AbortSignal;
  timeout?: number;
  onAbort?: () => void;
}

/**
 * Statistics about abort operations
 */
export interface IAbortStats {
  totalRegistered: number;
  totalAborted: number;
  activeRegistrations: number;
  byScope: Record<AbortScope, number>;
}
