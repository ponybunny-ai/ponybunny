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

export interface HarnessDaemonConfig {
  pollingIntervalMs: number;
  maxConcurrentGoals: number;
}

export class HarnessDaemon {
  private isRunning = false;
  private pollingTimer?: NodeJS.Timeout;
  private activeGoalCount = 0;

  constructor(
    private readonly repository: IWorkOrderRepository,
    private readonly goalHarness: IGoalHarness,
    private readonly config: HarnessDaemonConfig,
    private readonly postGoalEvaluator?: PostGoalEvaluator,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('HarnessDaemon is already running');
    }

    await this.repository.initialize();
    this.postGoalEvaluator?.start();
    this.isRunning = true;
    console.log('[HarnessDaemon] Started');
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
    console.log('[HarnessDaemon] Stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.cycle();
      } catch (error) {
        console.error('[HarnessDaemon] Cycle error:', error);
      }

      if (this.isRunning) {
        await this.sleep(this.config.pollingIntervalMs);
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
        console.error(`[HarnessDaemon] Failed to process goal ${goal.id}:`, result.reason);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollingTimer = setTimeout(resolve, ms);
    });
  }
}
