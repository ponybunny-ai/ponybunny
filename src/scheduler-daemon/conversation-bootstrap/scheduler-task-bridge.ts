import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { IConversationTaskMaterializer } from './conversation-task-materializer.js';

export class SchedulerTaskBridge {
  constructor(
    private repository: IWorkOrderRepository,
    private materializer: IConversationTaskMaterializer
  ) {}

  async createGoalFromConversation(
    requirements: {
      title: string;
      description: string;
      successCriteria: string[];
      constraints?: string[];
      priority?: 'low' | 'medium' | 'high';
      estimatedComplexity?: 'simple' | 'medium' | 'complex';
    },
    session: { id: string; personaId: string },
    sourceTurnId: string,
    options?: {
      sourceAgentId?: string;
    }
  ): Promise<{
    goalId: string;
    workItems: Array<{ id: string; title: string; status: string }>;
  }> {
    return this.materializer.materializeGoalFromConversation(
      requirements,
      session,
      sourceTurnId,
      options
    );
  }

  subscribeToProgress(_goalId: string, _callback: (progress: {
    goalId: string;
    goalStatus: string;
    completedItems: number;
    totalItems: number;
    startedAt: number;
    currentItem?: { id: string; title: string; status: string };
  }) => void): () => void {
    return () => undefined;
  }

  async getTaskStatus(goalId: string): Promise<{
    goalId: string;
    goalStatus: string;
    completedItems: number;
    totalItems: number;
    currentItem?: { id: string; title: string; status: string };
    startedAt: number;
  } | null> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) return null;

    const workItems = this.repository.getWorkItemsByGoal(goalId);
    const completedItems = workItems.filter((item) => item.status === 'done').length;
    const currentItem = workItems.find((item) => item.status === 'in_progress');

    return {
      goalId,
      goalStatus: goal.status,
      completedItems,
      totalItems: Math.max(workItems.length, 1),
      currentItem: currentItem
        ? {
            id: currentItem.id,
            title: currentItem.title,
            status: currentItem.status,
          }
        : undefined,
      startedAt: goal.created_at,
    };
  }

  async cancelTask(goalId: string): Promise<boolean> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) return false;
    if (goal.status === 'completed' || goal.status === 'cancelled') return false;

    this.repository.updateGoalStatus(goalId, 'cancelled');
    return true;
  }
}
