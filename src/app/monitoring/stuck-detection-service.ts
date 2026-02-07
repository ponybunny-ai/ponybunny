/**
 * Stuck Detection Service
 *
 * Monitors work items and runs to detect stuck states,
 * analyze error patterns, and suggest recovery actions.
 */

import type {
  IStuckDetectionService,
  IStuckDetectionConfig,
  IStuckWorkItem,
  IStuckRun,
  StuckReason,
  StuckAction,
  StuckEventHandler,
  IStuckEvent,
} from '../../domain/stuck/types.js';
import { DEFAULT_STUCK_CONFIG } from '../../domain/stuck/types.js';
import type { WorkItem, Run, WorkItemStatus, RunStatus } from '../../work-order/types/index.js';

// ============================================================================
// Repository Interfaces (for dependency injection)
// ============================================================================

export interface IWorkItemRepository {
  getWorkItem(id: string): WorkItem | undefined;
  getWorkItemsByGoal(goalId: string): WorkItem[];
  getWorkItemsByStatus(status: WorkItemStatus): WorkItem[];
}

export interface IRunRepository {
  getRun(id: string): Run | undefined;
  getRunsByWorkItem(workItemId: string): Run[];
  getRunsByStatus(status: RunStatus): Run[];
  getRunsByGoal(goalId: string): Run[];
}

// ============================================================================
// Stuck Detection Service Implementation
// ============================================================================

export class StuckDetectionService implements IStuckDetectionService {
  private config: IStuckDetectionConfig;
  private workItemRepo: IWorkItemRepository;
  private runRepo: IRunRepository;
  private acknowledgedItems = new Map<string, number>(); // workItemId -> expiresAt
  private eventHandlers: StuckEventHandler[] = [];
  private lastCheckTime = 0;

  constructor(
    workItemRepo: IWorkItemRepository,
    runRepo: IRunRepository,
    config: Partial<IStuckDetectionConfig> = {}
  ) {
    this.workItemRepo = workItemRepo;
    this.runRepo = runRepo;
    this.config = { ...DEFAULT_STUCK_CONFIG, ...config };
  }

  /**
   * Check all active work items for stuck state
   */
  async checkAllWorkItems(goalId?: string): Promise<IStuckWorkItem[]> {
    const now = Date.now();

    // Throttle checks
    if (now - this.lastCheckTime < this.config.checkIntervalMs) {
      return [];
    }
    this.lastCheckTime = now;

    // Clean expired acknowledgements
    this.cleanExpiredAcknowledgements();

    const stuckItems: IStuckWorkItem[] = [];

    // Get work items to check
    const activeStatuses: WorkItemStatus[] = ['ready', 'in_progress', 'blocked'];
    let workItems: WorkItem[] = [];

    if (goalId) {
      workItems = this.workItemRepo.getWorkItemsByGoal(goalId)
        .filter(item => activeStatuses.includes(item.status));
    } else {
      for (const status of activeStatuses) {
        workItems.push(...this.workItemRepo.getWorkItemsByStatus(status));
      }
    }

    // Check each work item
    for (const item of workItems) {
      if (this.isAcknowledged(item.id)) {
        continue;
      }

      const stuck = await this.checkWorkItem(item.id);
      if (stuck) {
        stuckItems.push(stuck);
        await this.emitEvent({
          type: 'work_item_stuck',
          timestamp: now,
          data: stuck,
        });
      }
    }

    return stuckItems;
  }

  /**
   * Check a specific work item for stuck state
   */
  async checkWorkItem(workItemId: string): Promise<IStuckWorkItem | null> {
    const item = this.workItemRepo.getWorkItem(workItemId);
    if (!item) {
      return null;
    }

    const now = Date.now();
    const runs = this.runRepo.getRunsByWorkItem(workItemId);
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
    const lastActivity = lastRun?.completed_at || lastRun?.created_at || item.updated_at;

    // Check for timeout in_progress
    if (item.status === 'in_progress') {
      const inProgressDuration = now - item.updated_at;
      if (inProgressDuration > this.config.maxInProgressDurationMs) {
        return this.createStuckWorkItem(item, 'timeout_in_progress',
          `Work item has been in_progress for ${Math.round(inProgressDuration / 60000)} minutes`,
          lastActivity);
      }
    }

    // Check for timeout ready
    if (item.status === 'ready') {
      const readyDuration = now - item.updated_at;
      if (readyDuration > this.config.maxReadyDurationMs) {
        return this.createStuckWorkItem(item, 'timeout_ready',
          `Work item has been ready for ${Math.round(readyDuration / 60000)} minutes without being picked up`,
          lastActivity);
      }
    }

    // Check for max retries exceeded
    if (item.retry_count >= this.config.maxTotalRetries) {
      return this.createStuckWorkItem(item, 'max_retries_exceeded',
        `Work item has exceeded maximum retries (${item.retry_count}/${this.config.maxTotalRetries})`,
        lastActivity);
    }

    // Check for repeated same error
    const errorAnalysis = await this.analyzeErrorPatterns(workItemId);
    if (errorAnalysis.isRepeating) {
      const repeatingPattern = errorAnalysis.patterns.find(p => p.count >= this.config.maxSameErrorRetries);
      if (repeatingPattern) {
        return this.createStuckWorkItem(item, 'repeated_same_error',
          `Same error has occurred ${repeatingPattern.count} times: ${repeatingPattern.signature}`,
          lastActivity,
          repeatingPattern.signature);
      }
    }

    // Check for missing dependencies
    for (const depId of item.dependencies) {
      const dep = this.workItemRepo.getWorkItem(depId);
      if (!dep) {
        return this.createStuckWorkItem(item, 'missing_dependency',
          `Depends on non-existent work item: ${depId}`,
          lastActivity);
      }
    }

    return null;
  }

  /**
   * Check all running runs for stuck state
   */
  async checkAllRuns(goalId?: string): Promise<IStuckRun[]> {
    const stuckRuns: IStuckRun[] = [];
    const now = Date.now();

    let runs: Run[];
    if (goalId) {
      runs = this.runRepo.getRunsByGoal(goalId).filter(r => r.status === 'running');
    } else {
      runs = this.runRepo.getRunsByStatus('running');
    }

    for (const run of runs) {
      const stuck = await this.checkRun(run.id);
      if (stuck) {
        stuckRuns.push(stuck);
        await this.emitEvent({
          type: 'run_stuck',
          timestamp: now,
          data: stuck,
        });
      }
    }

    return stuckRuns;
  }

  /**
   * Check a specific run for stuck state
   */
  async checkRun(runId: string): Promise<IStuckRun | null> {
    const run = this.runRepo.getRun(runId);
    if (!run || run.status !== 'running') {
      return null;
    }

    const now = Date.now();
    const runDuration = now - run.created_at;

    // Check for run timeout (default: 30 minutes for a single run)
    const maxRunDuration = this.config.maxInProgressDurationMs;
    if (runDuration > maxRunDuration) {
      return {
        runId: run.id,
        workItemId: run.work_item_id,
        goalId: run.goal_id,
        reason: 'run_timeout',
        details: `Run has been executing for ${Math.round(runDuration / 60000)} minutes`,
        startedAt: run.created_at,
        errorSignature: run.error_signature || undefined,
      };
    }

    return null;
  }

  /**
   * Detect circular dependencies in work items
   */
  async detectCircularDependencies(goalId: string): Promise<string[][]> {
    const workItems = this.workItemRepo.getWorkItemsByGoal(goalId);
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (itemId: string, path: string[]): boolean => {
      if (recursionStack.has(itemId)) {
        // Found a cycle
        const cycleStart = path.indexOf(itemId);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return true;
      }

      if (visited.has(itemId)) {
        return false;
      }

      visited.add(itemId);
      recursionStack.add(itemId);

      const item = workItems.find(i => i.id === itemId);
      if (item) {
        for (const depId of item.dependencies) {
          dfs(depId, [...path, itemId]);
        }
      }

      recursionStack.delete(itemId);
      return false;
    };

    for (const item of workItems) {
      if (!visited.has(item.id)) {
        dfs(item.id, []);
      }
    }

    // Emit events for any cycles found
    for (const cycle of cycles) {
      await this.emitEvent({
        type: 'dependency_cycle',
        timestamp: Date.now(),
        data: { cycle },
      });
    }

    return cycles;
  }

  /**
   * Get error pattern analysis for a work item
   */
  async analyzeErrorPatterns(workItemId: string): Promise<{
    patterns: Array<{ signature: string; count: number; lastSeen: number }>;
    isRepeating: boolean;
    suggestedFix?: string;
  }> {
    const runs = this.runRepo.getRunsByWorkItem(workItemId);
    const failedRuns = runs.filter(r => r.status === 'failure' && r.error_signature);

    // Count error signatures
    const signatureCounts = new Map<string, { count: number; lastSeen: number }>();
    for (const run of failedRuns) {
      const sig = run.error_signature!;
      const existing = signatureCounts.get(sig);
      if (existing) {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, run.completed_at || run.created_at);
      } else {
        signatureCounts.set(sig, {
          count: 1,
          lastSeen: run.completed_at || run.created_at,
        });
      }
    }

    // Convert to array and sort by count
    const patterns = Array.from(signatureCounts.entries())
      .map(([signature, data]) => ({
        signature,
        count: data.count,
        lastSeen: data.lastSeen,
      }))
      .sort((a, b) => b.count - a.count);

    // Check if any pattern is repeating above threshold
    const isRepeating = patterns.some(p => p.count >= this.config.maxSameErrorRetries);

    // Suggest fix based on common patterns
    let suggestedFix: string | undefined;
    if (isRepeating && patterns.length > 0) {
      const topPattern = patterns[0];
      if (topPattern.signature.includes('timeout')) {
        suggestedFix = 'Consider increasing timeout or breaking into smaller tasks';
      } else if (topPattern.signature.includes('permission')) {
        suggestedFix = 'Check permissions and escalate for credential access';
      } else if (topPattern.signature.includes('dependency')) {
        suggestedFix = 'Review and install missing dependencies';
      } else if (topPattern.signature.includes('syntax')) {
        suggestedFix = 'Review generated code for syntax errors';
      } else {
        suggestedFix = 'Consider escalating for human review';
      }
    }

    return { patterns, isRepeating, suggestedFix };
  }

  /**
   * Mark a stuck item as acknowledged
   */
  acknowledgeStuck(workItemId: string, durationMs: number = 30 * 60 * 1000): void {
    this.acknowledgedItems.set(workItemId, Date.now() + durationMs);
  }

  /**
   * Get current configuration
   */
  getConfig(): IStuckDetectionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<IStuckDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Register an event handler
   */
  onStuckEvent(handler: StuckEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove an event handler
   */
  offStuckEvent(handler: StuckEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createStuckWorkItem(
    item: WorkItem,
    reason: StuckReason,
    details: string,
    lastActivity: number,
    errorSignature?: string
  ): IStuckWorkItem {
    return {
      workItemId: item.id,
      goalId: item.goal_id,
      reason,
      details,
      stuckSince: item.updated_at,
      lastActivity,
      retryCount: item.retry_count,
      errorSignature,
      suggestedActions: this.getSuggestedActions(reason, item),
    };
  }

  private getSuggestedActions(reason: StuckReason, item: WorkItem): StuckAction[] {
    const actions: StuckAction[] = [];

    switch (reason) {
      case 'timeout_in_progress':
        actions.push('increase_timeout', 'escalate', 'skip');
        break;
      case 'timeout_ready':
        actions.push('reassign', 'escalate');
        break;
      case 'repeated_same_error':
        actions.push('change_approach', 'escalate', 'skip');
        break;
      case 'max_retries_exceeded':
        actions.push('escalate', 'skip', 'change_approach');
        break;
      case 'circular_dependency':
        actions.push('unblock_dependency', 'escalate');
        break;
      case 'missing_dependency':
        actions.push('unblock_dependency', 'escalate');
        break;
      case 'run_timeout':
        actions.push('increase_timeout', 'split', 'escalate');
        break;
      case 'no_progress':
        actions.push('change_approach', 'split', 'escalate');
        break;
    }

    // Add retry if under limit
    if (item.retry_count < item.max_retries) {
      actions.unshift('retry');
    }

    return actions;
  }

  private isAcknowledged(workItemId: string): boolean {
    const expiresAt = this.acknowledgedItems.get(workItemId);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.acknowledgedItems.delete(workItemId);
      return false;
    }
    return true;
  }

  private cleanExpiredAcknowledgements(): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.acknowledgedItems) {
      if (now > expiresAt) {
        this.acknowledgedItems.delete(id);
      }
    }
  }

  private async emitEvent(event: IStuckEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        // Log but don't throw
        console.error('Error in stuck event handler:', error);
      }
    }
  }
}
