/**
 * Stuck Detection Types
 *
 * Types for detecting and handling stuck work items and runs.
 */

// ============================================================================
// Stuck Detection Configuration
// ============================================================================

export interface IStuckDetectionConfig {
  /** Max time (ms) a work item can be in_progress before considered stuck */
  maxInProgressDurationMs: number;

  /** Max time (ms) a work item can be in 'ready' without being picked up */
  maxReadyDurationMs: number;

  /** Max consecutive failures with same error signature before escalation */
  maxSameErrorRetries: number;

  /** Max total retries before escalation */
  maxTotalRetries: number;

  /** Min time between stuck checks (throttle) */
  checkIntervalMs: number;

  /** Whether to auto-create escalations */
  autoEscalate: boolean;
}

export const DEFAULT_STUCK_CONFIG: IStuckDetectionConfig = {
  maxInProgressDurationMs: 30 * 60 * 1000,  // 30 minutes
  maxReadyDurationMs: 60 * 60 * 1000,        // 1 hour
  maxSameErrorRetries: 3,
  maxTotalRetries: 5,
  checkIntervalMs: 60 * 1000,                // 1 minute
  autoEscalate: true,
};

// ============================================================================
// Stuck Detection Results
// ============================================================================

export type StuckReason =
  | 'timeout_in_progress'      // Work item in_progress too long
  | 'timeout_ready'            // Work item ready but not picked up
  | 'repeated_same_error'      // Same error signature repeated
  | 'max_retries_exceeded'     // Hit retry limit
  | 'circular_dependency'      // Dependency cycle detected
  | 'missing_dependency'       // Depends on non-existent item
  | 'run_timeout'              // Run exceeded time limit
  | 'no_progress';             // No meaningful progress detected

export interface IStuckWorkItem {
  workItemId: string;
  goalId: string;
  reason: StuckReason;
  details: string;
  stuckSince: number;
  lastActivity: number;
  retryCount: number;
  errorSignature?: string;
  suggestedActions: StuckAction[];
}

export interface IStuckRun {
  runId: string;
  workItemId: string;
  goalId: string;
  reason: StuckReason;
  details: string;
  startedAt: number;
  errorSignature?: string;
}

export type StuckAction =
  | 'retry'                    // Retry the work item
  | 'escalate'                 // Create escalation for human
  | 'skip'                     // Skip and mark as failed
  | 'reassign'                 // Assign to different agent
  | 'split'                    // Split into smaller tasks
  | 'unblock_dependency'       // Resolve blocking dependency
  | 'increase_timeout'         // Allow more time
  | 'change_approach';         // Try different approach

// ============================================================================
// Stuck Detection Service Interface
// ============================================================================

export interface IStuckDetectionService {
  /**
   * Check all active work items for stuck state
   */
  checkAllWorkItems(goalId?: string): Promise<IStuckWorkItem[]>;

  /**
   * Check a specific work item for stuck state
   */
  checkWorkItem(workItemId: string): Promise<IStuckWorkItem | null>;

  /**
   * Check all running runs for stuck state
   */
  checkAllRuns(goalId?: string): Promise<IStuckRun[]>;

  /**
   * Check a specific run for stuck state
   */
  checkRun(runId: string): Promise<IStuckRun | null>;

  /**
   * Detect circular dependencies in work items
   */
  detectCircularDependencies(goalId: string): Promise<string[][]>;

  /**
   * Get error pattern analysis for a work item
   */
  analyzeErrorPatterns(workItemId: string): Promise<{
    patterns: Array<{ signature: string; count: number; lastSeen: number }>;
    isRepeating: boolean;
    suggestedFix?: string;
  }>;

  /**
   * Mark a stuck item as acknowledged (prevents re-detection for a period)
   */
  acknowledgeStuck(workItemId: string, durationMs?: number): void;

  /**
   * Get current configuration
   */
  getConfig(): IStuckDetectionConfig;

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IStuckDetectionConfig>): void;
}

// ============================================================================
// Stuck Event Types (for event emission)
// ============================================================================

export interface IStuckEvent {
  type: 'work_item_stuck' | 'run_stuck' | 'dependency_cycle';
  timestamp: number;
  data: IStuckWorkItem | IStuckRun | { cycle: string[] };
}

export type StuckEventHandler = (event: IStuckEvent) => void | Promise<void>;
