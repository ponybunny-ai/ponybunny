/**
 * HarnessDaemon — ADR-001 Polling Replacement for AutonomyDaemon
 *
 * Provides the polling loop that feeds queued goals into GoalHarness.
 * HarnessDaemon owns the timer and concurrency gating.
 * GoalHarness owns the lifecycle (elaborate → plan → delegate).
 *
 * This cleanly separates scheduling concerns (when to process) from
 * lifecycle concerns (how to process).
 */

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IGoalHarness } from './goal-harness-interface.js';
import type { PostGoalEvaluator } from './post-goal-evaluator.js';
import type { ILogger } from '../infra/observability/logger.js';
import { NoopLogger } from '../infra/observability/logger.js';

export interface HarnessDaemonConfig {
  pollingIntervalMs: number;
  maxConcurrentGoals: number;
}

export class HarnessDaemon {
  private isRunning = false;
  private pollingTimer?: NodeJS.Timeout;
  private activeGoalCount = 0;
  private wakeResolve: (() => void) | null = null;
  private readonly logger: ILogger;

  constructor(
    private readonly repository: IWorkOrderRepository,
    private readonly goalHarness: IGoalHarness,
    private readonly config: HarnessDaemonConfig,
    private readonly postGoalEvaluator?: PostGoalEvaluator,
    logger?: ILogger,
  ) {
    this.logger = logger ?? new NoopLogger();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('HarnessDaemon is already running');
    }

    await this.repository.initialize();
    this.postGoalEvaluator?.start();
    this.isRunning = true;
    this.logger.info({ event: 'harness_daemon_started' }, 'HarnessDaemon started');
    await this.mainLoop();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.postGoalEvaluator?.stop();
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.repository.close();
    this.logger.info({ event: 'harness_daemon_stopped' }, 'HarnessDaemon stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Signal the daemon to process pending goals immediately,
   * without waiting for the next polling interval.
   * Call this from Gateway after a new goal is submitted.
   */
  wake(): void {
    if (this.wakeResolve) {
      this.wakeResolve();
      this.wakeResolve = null;
    }
  }

  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.cycle();
      } catch (error) {
        this.logger.error({ event: 'harness_daemon_cycle_error' }, 'Cycle error', error as Error);
      }

      if (this.isRunning) {
        // Wait for polling interval OR wake signal, whichever comes first
        await Promise.race([
          this.sleep(this.config.pollingIntervalMs),
          new Promise<void>((resolve) => { this.wakeResolve = resolve; }),
        ]);
        this.wakeResolve = null;
      }
    }
  }

  private async cycle(): Promise<void> {
    const availableSlots = this.config.maxConcurrentGoals - this.activeGoalCount;
    if (availableSlots <= 0) {
      return;
    }

    const queuedGoals = this.repository.listGoals({ status: 'queued' });
    const goalsToProcess = queuedGoals.slice(0, availableSlots);

    if (goalsToProcess.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      goalsToProcess.map(async (goal) => {
        this.activeGoalCount++;
        try {
          return await this.goalHarness.processQueuedGoal(goal.id);
        } finally {
          this.activeGoalCount--;
        }
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const goal = goalsToProcess[i];
      if (result.status === 'rejected') {
        this.logger.error({ goalId: goal.id, event: 'goal_processing_failed' }, `Failed to process goal ${goal.id}`, result.reason as Error);
      } else if (result.status === 'fulfilled') {
        const harnessResult = result.value;
        // Goal was blocked during elaboration (not delegated, has escalations).
        // Create a ContextPack so blocked goals participate in the knowledge flywheel.
        if (harnessResult && !harnessResult.delegatedToScheduler && harnessResult.escalations.length > 0) {
          this.postGoalEvaluator?.createBlockedGoalContextPack(goal.id);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollingTimer = setTimeout(resolve, ms);
    });
  }
}
