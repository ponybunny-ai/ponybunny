import type { Goal, WorkItem, WorkItemType, EffortEstimate, VerificationPlan } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IPlanningService, PlanningResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { validateWorkItemInvariants } from '../../../domain/work-order/invariants.js';

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
  constructor(
    private repository: IWorkOrderRepository,
    private llmProvider: ILLMProvider
  ) {}

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
    const systemPrompt = `You are a Senior Technical Project Manager.
Your goal is to break down a high-level Goal into a Directed Acyclic Graph (DAG) of granular WorkItems.

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
        command: string, // Shell command to verify success (exit code 0). E.g. "npm test", "tsc", "ls dist/"
        required: true
      }
    ],
    acceptance_criteria: string[]
}

Rules:
1. Ensure the DAG is valid (no cycles).
2. Break down complex tasks into small, verifiable steps.
3. Every "code" item should ideally have a verification command.
4. Use standard tools: npm, node, tsc, git, jest.
`;

    const userPrompt = `Goal Title: ${goal.title}
Goal Description: ${goal.description}
Budget Tokens: ${goal.budget_tokens || 'N/A'}

Break this down into execution steps.`;

    try {
      const response = await this.llmProvider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: 0.2,
        model: 'gpt-4o',
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
