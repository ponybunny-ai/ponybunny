import { WorkOrderDatabase } from '../work-order/database/manager.js';
import { ReActIntegration } from './react-integration.js';
import type { Goal, WorkItem, Run } from '../work-order/types/index.js';

export interface AutonomyDaemonConfig {
  dbPath: string;
  maxConcurrentRuns: number;
  pollingIntervalMs: number;
  maxConsecutiveErrors: number;
}

export interface WorkCycleResult {
  success: boolean;
  run: Run;
  shouldEscalate: boolean;
  escalationReason?: string;
}

export class AutonomyDaemon {
  private db: WorkOrderDatabase;
  private reactIntegration: ReActIntegration;
  private isRunning = false;
  private pollingTimer?: NodeJS.Timeout;
  private activeRuns = new Map<string, AbortController>();

  constructor(private config: AutonomyDaemonConfig) {
    this.db = new WorkOrderDatabase(config.dbPath);
    this.reactIntegration = new ReActIntegration();
  }

  async start(): Promise<void> {
    await this.db.initialize();
    this.isRunning = true;
    await this.mainLoop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
    }
    this.activeRuns.forEach(controller => controller.abort());
    this.activeRuns.clear();
    this.db.close();
  }

  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.cycle();
      } catch (error) {
        console.error('[AutonomyDaemon] Cycle error:', error);
      }

      if (this.isRunning) {
        await this.sleep(this.config.pollingIntervalMs);
      }
    }
  }

  private async cycle(): Promise<void> {
    if (this.activeRuns.size >= this.config.maxConcurrentRuns) {
      return;
    }

    const availableSlots = this.config.maxConcurrentRuns - this.activeRuns.size;
    const readyWorkItems = this.db.getReadyWorkItems().slice(0, availableSlots);

    if (readyWorkItems.length === 0) {
      this.updatePendingWorkItemStatuses();
      return;
    }

    await Promise.all(readyWorkItems.map(workItem => this.executeWorkItem(workItem)));
  }

  private updatePendingWorkItemStatuses(): void {
    const pendingItems = this.db.listGoals({ status: 'active' })
      .flatMap(goal => this.db.getReadyWorkItems(goal.id))
      .filter(item => item.status === 'pending');

    pendingItems.forEach(item => {
      this.db.updateWorkItemStatusIfDependenciesMet(item.id);
    });
  }

  private async executeWorkItem(workItem: WorkItem): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(workItem.id, controller);

    try {
      this.db.updateWorkItemStatus(workItem.id, 'in_progress');

      const runSequence = this.db.getRunsByWorkItem(workItem.id).length + 1;
      const run = this.db.createRun({
        work_item_id: workItem.id,
        goal_id: workItem.goal_id,
        agent_type: workItem.assigned_agent || 'default',
        run_sequence: runSequence,
      });

      const result = await this.executeReActCycle(workItem, run, controller.signal);

      if (result.success) {
        await this.handleSuccessfulRun(workItem, result);
      } else {
        await this.handleFailedRun(workItem, result);
      }
    } catch (error) {
      console.error(`[AutonomyDaemon] Error executing work item ${workItem.id}:`, error);
      this.db.updateWorkItemStatus(workItem.id, 'failed');
    } finally {
      this.activeRuns.delete(workItem.id);
    }
  }

  private async executeReActCycle(
    workItem: WorkItem,
    run: Run,
    signal: AbortSignal
  ): Promise<WorkCycleResult> {
    const startTime = Date.now();

    try {
      const agentResult = await this.callReActAgent({
        workItem,
        run,
        signal,
      });

      const timeSeconds = Math.floor((Date.now() - startTime) / 1000);

      this.db.completeRun(run.id, {
        status: agentResult.success ? 'success' : 'failure',
        error_message: agentResult.error,
        tokens_used: agentResult.tokensUsed,
        time_seconds: timeSeconds,
        cost_usd: agentResult.costUsd,
        artifacts: agentResult.artifactIds || [],
        execution_log: agentResult.log,
      });

      this.db.updateGoalSpending(
        workItem.goal_id,
        agentResult.tokensUsed,
        Math.ceil(timeSeconds / 60),
        agentResult.costUsd
      );

      if (agentResult.success) {
        const verificationResult = await this.runQualityGates(workItem);
        return {
          success: verificationResult.passed,
          run,
          shouldEscalate: !verificationResult.passed,
          escalationReason: verificationResult.failureReason,
        };
      }

      const shouldEscalate = this.shouldEscalateError(workItem);
      return {
        success: false,
        run,
        shouldEscalate,
        escalationReason: shouldEscalate ? `Repeated error pattern detected` : undefined,
      };
    } catch (error) {
      const timeSeconds = Math.floor((Date.now() - startTime) / 1000);
      this.db.completeRun(run.id, {
        status: 'failure',
        error_message: String(error),
        tokens_used: 0,
        time_seconds: timeSeconds,
        cost_usd: 0,
        artifacts: [],
      });

      return {
        success: false,
        run,
        shouldEscalate: true,
        escalationReason: `Execution exception: ${error}`,
      };
    }
  }

  private async callReActAgent(params: {
    workItem: WorkItem;
    run: Run;
    signal: AbortSignal;
  }): Promise<{
    success: boolean;
    error?: string;
    tokensUsed: number;
    costUsd: number;
    artifactIds?: string[];
    log?: string;
  }> {
    return await this.reactIntegration.executeWorkCycle(params);
  }

  private async runQualityGates(workItem: WorkItem): Promise<{
    passed: boolean;
    failureReason?: string;
  }> {
    if (!workItem.verification_plan) {
      return { passed: true };
    }

    for (const gate of workItem.verification_plan.quality_gates) {
      if (!gate.required) continue;

      if (gate.type === 'deterministic') {
        const result = await this.runDeterministicGate(gate);
        if (!result.passed) {
          return { passed: false, failureReason: `Gate '${gate.name}' failed: ${result.reason}` };
        }
      }
    }

    return { passed: true };
  }

  private async runDeterministicGate(gate: any): Promise<{
    passed: boolean;
    reason?: string;
  }> {
    return { passed: true };
  }

  private shouldEscalateError(workItem: WorkItem): boolean {
    if (workItem.retry_count >= workItem.max_retries) {
      return true;
    }

    const repeatedErrors = this.db.getRepeatedErrorSignatures(
      workItem.id,
      this.config.maxConsecutiveErrors
    );
    
    return repeatedErrors.length > 0;
  }

  private async handleSuccessfulRun(workItem: WorkItem, result: WorkCycleResult): Promise<void> {
    if (result.shouldEscalate) {
      this.db.createEscalation({
        work_item_id: workItem.id,
        goal_id: workItem.goal_id,
        run_id: result.run.id,
        escalation_type: 'validation_failed',
        severity: 'medium',
        title: `Quality gates failed for: ${workItem.title}`,
        description: result.escalationReason || 'Verification failed',
      });
      this.db.updateWorkItemStatus(workItem.id, 'blocked');
    } else {
      this.db.updateWorkItemStatus(workItem.id, 'completed');
      this.unblockDependentWorkItems(workItem);
      this.checkGoalCompletion(workItem.goal_id);
    }
  }

  private async handleFailedRun(workItem: WorkItem, result: WorkCycleResult): Promise<void> {
    this.db.incrementWorkItemRetry(workItem.id);

    if (result.shouldEscalate) {
      this.db.createEscalation({
        work_item_id: workItem.id,
        goal_id: workItem.goal_id,
        run_id: result.run.id,
        escalation_type: 'stuck',
        severity: 'high',
        title: `Work item stuck: ${workItem.title}`,
        description: result.escalationReason || 'Max retries exceeded or repeated errors',
      });
      this.db.updateWorkItemStatus(workItem.id, 'blocked');
    } else {
      this.db.updateWorkItemStatus(workItem.id, 'ready');
    }
  }

  private unblockDependentWorkItems(completedItem: WorkItem): void {
    const blockedItems = this.db.getBlockedWorkItems(completedItem.id);
    blockedItems.forEach(item => {
      this.db.updateWorkItemStatusIfDependenciesMet(item.id);
    });
  }

  private checkGoalCompletion(goal_id: string): void {
    const goal = this.db.getGoal(goal_id);
    if (!goal || goal.status !== 'active') return;

    const workItems = this.db.getReadyWorkItems(goal_id);
    const allCompleted = workItems.every(item => item.status === 'completed');

    if (allCompleted) {
      this.db.updateGoalStatus(goal_id, 'completed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
