/**
 * Task Bridge
 * Bridges conversation layer with the scheduler for goal creation and monitoring
 */

import type { IExtractedRequirements } from '../../domain/conversation/analysis.js';
import type { IConversationSession } from '../../domain/conversation/session.js';
import type { Goal, WorkItem, SuccessCriterion } from '../../work-order/types/index.js';

export interface IWorkItemInfo {
  id: string;
  title: string;
  status: string;
}

export interface IGoalCreationResult {
  goalId: string;
  workItems: IWorkItemInfo[];
}

export interface ITaskProgress {
  goalId: string;
  goalStatus: string;
  completedItems: number;
  totalItems: number;
  currentItem?: IWorkItemInfo;
  startedAt: number;
}

export interface ITaskResult {
  goalId: string;
  success: boolean;
  summary: string;
  artifacts: Array<{ type: string; path?: string; description: string }>;
  completedAt: number;
  errorMessage?: string;
}

export type ProgressCallback = (progress: ITaskProgress) => void;
export type Unsubscribe = () => void;

export interface ITaskBridge {
  createGoalFromConversation(
    requirements: IExtractedRequirements,
    session: IConversationSession
  ): Promise<IGoalCreationResult>;

  subscribeToProgress(goalId: string, callback: ProgressCallback): Unsubscribe;

  getTaskStatus(goalId: string): Promise<ITaskProgress | null>;

  cancelTask(goalId: string): Promise<boolean>;
}

export interface IWorkOrderRepository {
  createGoal(params: Partial<Goal>): Goal;
  getGoal(id: string): Goal | undefined;
  updateGoalStatus(id: string, status: Goal['status']): void;
  getWorkItemsByGoal(goalId: string): WorkItem[];
}

export interface ISchedulerCore {
  submitGoal(goal: Goal): Promise<void>;
}

export class TaskBridge implements ITaskBridge {
  private progressSubscriptions = new Map<string, Set<ProgressCallback>>();
  private progressIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private repository: IWorkOrderRepository,
    private getScheduler: () => ISchedulerCore | null
  ) {}

  async createGoalFromConversation(
    requirements: IExtractedRequirements,
    session: IConversationSession
  ): Promise<IGoalCreationResult> {
    // Create goal from extracted requirements
    const successCriteria: SuccessCriterion[] = requirements.successCriteria.map((criterion, index) => ({
      id: `sc-${index + 1}`,
      description: criterion,
      type: 'heuristic' as const,
      verification_method: 'manual',
      required: true,
    }));

    const goal = this.repository.createGoal({
      title: requirements.title,
      description: requirements.description,
      success_criteria: successCriteria,
      priority: this.mapPriority(requirements.priority),
      budget_tokens: this.estimateBudget(requirements.estimatedComplexity),
      status: 'queued',
      context: {
        conversationSessionId: session.id,
        personaId: session.personaId,
        createdViaConversation: true,
      },
    });

    // Start goal execution if scheduler is available
    const scheduler = this.getScheduler();
    if (scheduler) {
      // Queue the execution asynchronously
      setImmediate(() => {
        scheduler.submitGoal(goal).catch(error => {
          console.error(`[TaskBridge] Failed to submit goal: ${error}`);
        });
      });
    }

    // Get work items (may be empty initially, created by scheduler)
    const workItems = this.repository.getWorkItemsByGoal(goal.id);

    return {
      goalId: goal.id,
      workItems: workItems.map(wi => ({
        id: wi.id,
        title: wi.title,
        status: wi.status,
      })),
    };
  }

  subscribeToProgress(goalId: string, callback: ProgressCallback): Unsubscribe {
    if (!this.progressSubscriptions.has(goalId)) {
      this.progressSubscriptions.set(goalId, new Set());
      this.startProgressPolling(goalId);
    }

    this.progressSubscriptions.get(goalId)!.add(callback);

    return () => {
      const subs = this.progressSubscriptions.get(goalId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.stopProgressPolling(goalId);
          this.progressSubscriptions.delete(goalId);
        }
      }
    };
  }

  async getTaskStatus(goalId: string): Promise<ITaskProgress | null> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) {
      return null;
    }

    const workItems = this.repository.getWorkItemsByGoal(goalId);
    const completedItems = workItems.filter(wi => wi.status === 'done').length;
    const currentItem = workItems.find(wi => wi.status === 'in_progress');

    return {
      goalId,
      goalStatus: goal.status,
      completedItems,
      totalItems: workItems.length || 1,
      currentItem: currentItem ? {
        id: currentItem.id,
        title: currentItem.title,
        status: currentItem.status,
      } : undefined,
      startedAt: goal.created_at,
    };
  }

  async cancelTask(goalId: string): Promise<boolean> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) {
      return false;
    }

    if (goal.status === 'completed' || goal.status === 'cancelled') {
      return false;
    }

    this.repository.updateGoalStatus(goalId, 'cancelled');
    this.stopProgressPolling(goalId);

    return true;
  }

  private startProgressPolling(goalId: string): void {
    const interval = setInterval(async () => {
      const progress = await this.getTaskStatus(goalId);
      if (progress) {
        const subs = this.progressSubscriptions.get(goalId);
        if (subs) {
          for (const callback of subs) {
            try {
              callback(progress);
            } catch (error) {
              console.error('[TaskBridge] Progress callback error:', error);
            }
          }
        }

        // Stop polling if task is complete
        if (['completed', 'cancelled'].includes(progress.goalStatus)) {
          this.stopProgressPolling(goalId);
        }
      }
    }, 2000); // Poll every 2 seconds

    this.progressIntervals.set(goalId, interval);
  }

  private stopProgressPolling(goalId: string): void {
    const interval = this.progressIntervals.get(goalId);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(goalId);
    }
  }

  private mapPriority(priority?: 'low' | 'medium' | 'high'): number {
    switch (priority) {
      case 'high': return 1;
      case 'medium': return 5;
      case 'low': return 10;
      default: return 5;
    }
  }

  private estimateBudget(complexity?: 'simple' | 'medium' | 'complex'): number {
    switch (complexity) {
      case 'simple': return 50000;
      case 'complex': return 500000;
      case 'medium':
      default: return 150000;
    }
  }
}
