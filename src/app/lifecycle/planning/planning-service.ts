import type { Goal, WorkItem, WorkItemType, EffortEstimate, VerificationPlan } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IPlanningService, PlanningResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import type { IModelSelector } from '../../../scheduler/model-selector/types.js';
import type { RuntimeToolingContext } from '../../../runtime/tooling-context/index.js';
import type { GlobalKnowledgeService } from '../../../domain/knowledge/index.js';
import type { ILogger } from '../../../infra/observability/logger.js';
import { NoopLogger } from '../../../infra/observability/logger.js';
import { PromptProvider } from '../../../infra/prompts/prompt-provider.js';
import { ModelSelector } from '../../../scheduler/model-selector/model-selector.js';
import { getLegacyCompatiblePromptProvider } from '../../../infra/prompts/legacy-prompt-tooling-compatibility.js';

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
  private promptProvider: PromptProvider;
  private globalKnowledge?: GlobalKnowledgeService;
  private readonly logger: ILogger;

  constructor(
    private repository: IWorkOrderRepository,
    private llmProvider: ILLMProvider,
    modelSelector?: IModelSelector,
    runtimeToolingContext?: RuntimeToolingContext,
    globalKnowledge?: GlobalKnowledgeService,
    logger?: ILogger
  ) {
    this.modelSelector = modelSelector ?? new ModelSelector();
    this.promptProvider = runtimeToolingContext?.getPromptProvider()
      ?? getLegacyCompatiblePromptProvider(() => new PromptProvider());
    this.globalKnowledge = globalKnowledge;
    this.logger = logger ?? new NoopLogger();
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

    // Inject known pitfalls and patterns from global knowledge (if available)
    let knowledgeSection = '';
    if (this.globalKnowledge) {
      try {
        const pitfalls = this.globalKnowledge.getRelevantKnowledge({ knowledgeType: 'pitfall', limit: 5, minConfidence: 0.3 });
        const patterns = this.globalKnowledge.getRelevantKnowledge({ knowledgeType: 'pattern', limit: 3, minConfidence: 0.3 });
        const approaches = this.globalKnowledge.getRelevantKnowledge({ knowledgeType: 'approach', limit: 3, minConfidence: 0.3 });

        const sections: string[] = [];
        if (pitfalls.length > 0) {
          sections.push('Known Pitfalls (avoid these):\n' + pitfalls.map(p => `- ${p.content}`).join('\n'));
        }
        if (patterns.length > 0) {
          sections.push('Known Patterns:\n' + patterns.map(p => `- ${p.content}`).join('\n'));
        }
        if (approaches.length > 0) {
          sections.push('Proven Approaches:\n' + approaches.map(a => `- ${a.content}`).join('\n'));
        }

        if (sections.length > 0) {
          knowledgeSection = '\n\n--- GLOBAL KNOWLEDGE (from previous goals) ---\n' + sections.join('\n\n') + '\n--- END GLOBAL KNOWLEDGE ---\n';
        }
      } catch {
        // global_knowledge table may not exist yet — graceful degradation
      }
    }

    const userPrompt = `Goal Title: ${goal.title}
Goal Description: ${goal.description}
Budget Tokens: ${goal.budget_tokens || 'N/A'}
${knowledgeSection}
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
      this.logger.debug({ event: 'model_selected', reasoning: selection.reasoning }, 'Model selection reasoning');

      const response = await this.llmProvider.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ], {
        temperature: 0.2,
        model: selection.model,
      });

      const content = (response.content || '').replace(/```json/g, '').replace(/```/g, '').trim();
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
