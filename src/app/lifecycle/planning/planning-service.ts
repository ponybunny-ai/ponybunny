import type { Goal, WorkItem, WorkItemType, EffortEstimate, VerificationPlan } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IPlanningService, PlanningResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import type { IModelSelector } from '../../../scheduler/model-selector/types.js';
import { ModelSelector } from '../../../scheduler/model-selector/model-selector.js';
import { getGlobalPromptProvider } from '../../../infra/prompts/prompt-provider.js';

interface PlannedItem {
  id: string;
  title: string;
  description: string;
  item_type: WorkItemType;
  priority: number;
  estimated_effort: EffortEstimate;
  dependencies: string[];
  verification_plan: VerificationPlan;
}

export class PlanningService implements IPlanningService {
  private modelSelector: IModelSelector;
  private promptProvider = getGlobalPromptProvider();

  constructor(
    private repository: IWorkOrderRepository,
    private llmProvider: ILLMProvider,
    modelSelector?: IModelSelector
  ) {
    this.modelSelector = modelSelector ?? new ModelSelector();
  }

  async planWorkItems(goal: Goal): Promise<PlanningResult> {
    const workItems: WorkItem[] = [];
    const dependencies = new Map<string, string[]>();

    const existingItems = this.repository.getReadyWorkItems(goal.id);
    if (existingItems.length > 0) {
      return {
        workItems: existingItems,
        dependencies: this.buildDependencyMap(existingItems),
      };
    }

    const plannedItems = await this.generatePlanWithLLM(goal);
    const idMap = new Map<string, string>();
    
    const sortedPlans = this.topologicalSort(plannedItems);
    
    for (const plan of sortedPlans) {
      const resolvedDeps = plan.dependencies
        .map(depId => idMap.get(depId))
        .filter((id): id is string => !!id);

      const workItem = this.repository.createWorkItem({
        goal_id: goal.id,
        title: plan.title,
        description: plan.description,
        item_type: plan.item_type,
        priority: plan.priority,
        verification_plan: plan.verification_plan,
        dependencies: resolvedDeps,
      });

      idMap.set(plan.id, workItem.id);
      workItems.push(workItem);
    }
    
    for (const item of workItems) {
      dependencies.set(item.id, item.dependencies);
    }

    return {
      workItems,
      dependencies,
    };
  }

  private async generatePlanWithLLM(goal: Goal): Promise<PlannedItem[]> {
    // Use enhanced phase-aware system prompt
    const systemPrompt = this.promptProvider.generatePlanningPrompt({
      workspaceDir: process.cwd(),
      goal,
      budgetTokens: goal.budget_tokens,
      spentTokens: goal.spent_tokens,
    });

    const userPrompt = `Goal Title: ${goal.title}
Goal Description: ${goal.description}
Budget Tokens: ${goal.budget_tokens || 'N/A'}

Break this down into execution steps.

Output format: JSON array of objects.
Do not include markdown blocks or backticks. Return ONLY the JSON.

Each object must have:
- id: string (temporary ID, e.g., "1", "2")
- title: string
- description: string (detailed, actionable steps)
- item_type: "code" | "test" | "doc" | "analysis"
- priority: number (1-100, where 100 is highest)
- estimated_effort: "S" | "M" | "L" | "XL"
- dependencies: string[] (IDs of other items that must finish first)
- verification_plan: {
    quality_gates: [
      {
        name: string,
        type: "deterministic",
        command: string, // Shell command to verify success (exit code 0)
        required: true
      }
    ],
    acceptance_criteria: string[]
}`;

    try {
      const selection = this.modelSelector.selectModelForPlanning(goal);
      console.log(`[PlanningService] ${selection.reasoning}`);

      const response = await this.llmProvider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: 0.2,
        model: selection.model,
      });

      const content = response.content.replace(/```json/g, '').replace(/```/g, '').trim();
      const plans = JSON.parse(content) as PlannedItem[];

      return plans;
    } catch (error) {
      throw new Error(`Failed to generate plan: ${error}`);
    }
  }

  private topologicalSort(items: PlannedItem[]): PlannedItem[] {
    const visited = new Set<string>();
    const result: PlannedItem[] = [];
    const itemMap = new Map<string, PlannedItem>();
    
    for (const item of items) {
      itemMap.set(item.id, item);
    }

    const visit = (itemId: string, path: Set<string>) => {
      if (path.has(itemId)) {
        throw new Error(`Cyclic dependency detected involving ${itemId}`);
      }
      if (visited.has(itemId)) return;

      path.add(itemId);
      const item = itemMap.get(itemId);
      if (!item) throw new Error(`Dependency ${itemId} not found in plan`);

      for (const depId of item.dependencies) {
        visit(depId, path);
      }

      path.delete(itemId);
      visited.add(itemId);
      result.push(item);
    };

    for (const item of items) {
      visit(item.id, new Set());
    }

    return result;
  }

  private buildDependencyMap(workItems: WorkItem[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    for (const item of workItems) {
      deps.set(item.id, item.dependencies);
    }
    return deps;
  }
}
