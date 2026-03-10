import fs from 'node:fs';
import path from 'node:path';

import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { Goal } from '../../work-order/types/index.js';
import type { SchedulerCore } from '../../scheduler/core/index.js';
import { getUserAgentsDir } from '../../infra/agents/agent-discovery.js';
import { loadRuntimeConfig, type PonyBunnyRuntimeConfig } from '../../infra/config/runtime-config.js';

interface ResolveMainAgentModelHintOptions {
  runtimeConfig?: PonyBunnyRuntimeConfig;
  agentId?: string;
  userAgentsDir?: string;
  workspaceDir?: string;
  fileExists?: (filePath: string) => boolean;
  readTextFile?: (filePath: string) => string;
}

export function resolveMainAgentModelHintFromAgentConfig(
  options: ResolveMainAgentModelHintOptions = {}
): string | undefined {
  const runtime = options.runtimeConfig ?? loadRuntimeConfig();
  const agentId = typeof options.agentId === 'string' && options.agentId.trim().length > 0
    ? options.agentId.trim()
    : runtime.agent.mainAgentId;

  const runtimeOverrideRaw = runtime.agent.modelOverrides?.[agentId];
  if (typeof runtimeOverrideRaw === 'string') {
    const runtimeOverride = runtimeOverrideRaw.trim();
    if (runtimeOverride.length > 0) {
      return runtimeOverride.toLowerCase() === 'auto' ? undefined : runtimeOverride;
    }
  }

  const userAgentsDir = options.userAgentsDir ?? getUserAgentsDir();
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const fileExists = options.fileExists ?? fs.existsSync;
  const readTextFile = options.readTextFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf-8'));

  const userAgentConfigPath = path.join(userAgentsDir, agentId, 'agent.json');
  const workspaceAgentConfigPath = path.join(workspaceDir, 'agents', agentId, 'agent.json');

  const sourcePath = fileExists(userAgentConfigPath)
    ? userAgentConfigPath
    : fileExists(workspaceAgentConfigPath)
      ? workspaceAgentConfigPath
      : null;

  if (!sourcePath) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readTextFile(sourcePath)) as {
      runner?: {
        config?: {
          model_hint?: unknown;
        };
      };
    };
    const hint = parsed.runner?.config?.model_hint;
    if (typeof hint !== 'string') {
      return undefined;
    }

    const trimmedHint = hint.trim();
    return trimmedHint.length > 0 ? trimmedHint : undefined;
  } catch {
    return undefined;
  }
}

export class SchedulerTaskBridge {
  constructor(
    private repository: IWorkOrderRepository,
    private schedulerProvider: () => SchedulerCore | null,
    private resolveModelHint: (agentId?: string) => string | undefined =
      (agentId?: string) => resolveMainAgentModelHintFromAgentConfig({ agentId })
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
    const selectedModel = this.resolveModelHint(options?.sourceAgentId);

    const goal = this.repository.createGoal({
      title: requirements.title,
      description: requirements.description,
      success_criteria: requirements.successCriteria.map((description) => ({
        description,
        type: 'heuristic',
        verification_method: 'manual',
        required: true,
      })),
      priority: this.mapPriority(requirements.priority),
      budget_tokens: this.estimateBudget(requirements.estimatedComplexity),
      context: {
        createdViaConversation: true,
        sessionId: session.id,
        turnId: sourceTurnId,
        personaId: session.personaId,
        ...(selectedModel ? { selected_model: selectedModel } : {}),
      },
    });

    const workItem = this.repository.createWorkItem({
      goal_id: goal.id,
      title: goal.title,
      description: goal.description,
      item_type: 'analysis',
      priority: goal.priority,
      dependencies: [],
      context: {
        ...(goal.context ?? {}),
        createdViaConversation: true,
        ...(selectedModel
          ? {
              selected_model: selectedModel,
              model: selectedModel,
            }
          : {}),
      },
    });

    const scheduler = this.schedulerProvider();
    if (scheduler) {
      await scheduler.submitGoal(goal as Goal);
    }

    return {
      goalId: goal.id,
      workItems: [
        {
          id: workItem.id,
          title: workItem.title,
          status: workItem.status,
        },
      ],
    };
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

  private mapPriority(priority?: 'low' | 'medium' | 'high'): number {
    if (priority === 'high') return 1;
    if (priority === 'low') return 10;
    return 5;
  }

  private estimateBudget(complexity?: 'simple' | 'medium' | 'complex'): number {
    if (complexity === 'simple') return 50_000;
    if (complexity === 'complex') return 500_000;
    return 150_000;
  }
}
