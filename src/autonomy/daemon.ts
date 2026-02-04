import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IExecutionService, IVerificationService, IEvaluationService, IPlanningService } from '../app/lifecycle/stage-interfaces.js';
import type { WorkItem, Goal } from '../work-order/types/index.js';

export interface AutonomyDaemonConfig {
  maxConcurrentRuns: number;
  pollingIntervalMs: number;
}

export class AutonomyDaemon {
  private isRunning = false;
  private pollingTimer?: NodeJS.Timeout;
  private activeRuns = new Map<string, AbortController>();

  constructor(
    private repository: IWorkOrderRepository,
    private planningService: IPlanningService,
    private executionService: IExecutionService,
    private verificationService: IVerificationService,
    private evaluationService: IEvaluationService,
    private config: AutonomyDaemonConfig
  ) {}

  async start(): Promise<void> {
    await this.repository.initialize();
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
    this.repository.close();
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
    await this.processQueuedGoals();
    
    if (this.activeRuns.size >= this.config.maxConcurrentRuns) {
      return;
    }

    const availableSlots = this.config.maxConcurrentRuns - this.activeRuns.size;
    const readyWorkItems = this.repository.getReadyWorkItems().slice(0, availableSlots);

    if (readyWorkItems.length === 0) {
      this.updatePendingWorkItemStatuses();
      return;
    }

    await Promise.all(readyWorkItems.map(workItem => this.executeWorkItem(workItem)));
  }

  private async processQueuedGoals(): Promise<void> {
    const queuedGoals = this.repository.listGoals({ status: 'queued' });
    
    for (const goal of queuedGoals) {
      try {
        console.log(`[AutonomyDaemon] Planning goal: ${goal.title} (${goal.id})`);
        const plan = await this.planningService.planWorkItems(goal);
        
        if (plan.workItems.length > 0) {
          console.log(`[AutonomyDaemon] Plan created with ${plan.workItems.length} work items`);
          this.repository.updateGoalStatus(goal.id, 'active');
        } else {
          console.warn(`[AutonomyDaemon] Planning returned 0 items for goal ${goal.id}`);
        }
      } catch (error) {
        console.error(`[AutonomyDaemon] Failed to plan goal ${goal.id}:`, error);
      }
    }
  }

  private updatePendingWorkItemStatuses(): void {
    const activeGoals = this.repository.listGoals({ status: 'active' });
    
    for (const goal of activeGoals) {
      const goalWorkItems = this.repository.getReadyWorkItems(goal.id);
      const pendingItems = goalWorkItems.filter(item => item.status === 'queued');
      
      for (const item of pendingItems) {
        this.repository.updateWorkItemStatusIfDependenciesMet(item.id);
      }
    }
  }

  private async executeWorkItem(workItem: WorkItem): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(workItem.id, controller);

    try {
      this.repository.updateWorkItemStatus(workItem.id, 'in_progress');

      const executionResult = await this.executionService.executeWorkItem(workItem);

      if (executionResult.success) {
        const verificationResult = await this.verificationService.verifyWorkItem(
          workItem,
          executionResult.run
        );

        const evaluationResult = await this.evaluationService.evaluateRun(
          workItem,
          executionResult.run,
          verificationResult
        );

        await this.applyEvaluationDecision(workItem, evaluationResult);
      } else {
        const verificationResult = { passed: false, gateResults: [] };
        const evaluationResult = await this.evaluationService.evaluateRun(
          workItem,
          executionResult.run,
          verificationResult
        );

        await this.applyEvaluationDecision(workItem, evaluationResult);
      }
    } catch (error) {
      console.error(`[AutonomyDaemon] Error executing work item ${workItem.id}:`, error);
      this.repository.updateWorkItemStatus(workItem.id, 'failed');
    } finally {
      this.activeRuns.delete(workItem.id);
    }
  }

  private async applyEvaluationDecision(
    workItem: WorkItem,
    evaluation: { decision: 'publish' | 'retry' | 'replan' | 'escalate'; reasoning: string; nextActions: string[] }
  ): Promise<void> {
    switch (evaluation.decision) {
      case 'publish':
        this.repository.updateWorkItemStatus(workItem.id, 'done');
        this.unblockDependentWorkItems(workItem);
        this.checkGoalCompletion(workItem.goal_id);
        break;

      case 'retry':
        this.repository.incrementWorkItemRetry(workItem.id);
        this.repository.updateWorkItemStatus(workItem.id, 'ready');
        break;

      case 'escalate':
        this.repository.createEscalation({
          work_item_id: workItem.id,
          goal_id: workItem.goal_id,
          escalation_type: 'stuck',
          severity: 'high',
          title: `Work item stuck: ${workItem.title}`,
          description: evaluation.reasoning,
        });
        this.repository.updateWorkItemStatus(workItem.id, 'blocked');
        break;

      case 'replan':
        this.repository.updateWorkItemStatus(workItem.id, 'blocked');
        break;
    }
  }

  private unblockDependentWorkItems(completedItem: WorkItem): void {
    const blockedItems = this.repository.getBlockedWorkItems(completedItem.id);
    for (const item of blockedItems) {
      this.repository.updateWorkItemStatusIfDependenciesMet(item.id);
    }
  }

  private checkGoalCompletion(goal_id: string): void {
    const goal = this.repository.getGoal(goal_id);
    if (!goal || goal.status !== 'active') return;

    const workItems = this.repository.getReadyWorkItems(goal_id);
    const allCompleted = workItems.every(item => item.status === 'done');

    if (allCompleted) {
      this.repository.updateGoalStatus(goal_id, 'completed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
