import type { Goal } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { GlobalKnowledgeService } from '../../../domain/knowledge/index.js';
import type { GoalIntent, ExtractedConstraint } from '../../../domain/work-order/types/goal-intent.js';
import type { IElaborationService, ElaborationResult } from '../stage-interfaces.js';

export class ElaborationService implements IElaborationService {
  private globalKnowledge?: GlobalKnowledgeService;

  constructor(
    private repository: IWorkOrderRepository,
    globalKnowledge?: GlobalKnowledgeService,
  ) {
    this.globalKnowledge = globalKnowledge;
  }

  async elaborateGoal(goal: Goal): Promise<ElaborationResult> {
    const clarifications: string[] = [];
    const escalations: string[] = [];

    if (!goal.success_criteria || goal.success_criteria.length === 0) {
      escalations.push('No success criteria defined - cannot proceed without clear completion definition');
    }

    const hasDeterministicCriteria = goal.success_criteria.some(
      sc => sc.type === 'deterministic' && sc.required
    );

    if (!hasDeterministicCriteria) {
      clarifications.push('No required deterministic success criteria - recommend adding testable gates');
    }

    if (!goal.budget_tokens && !goal.budget_time_minutes && !goal.budget_cost_usd) {
      clarifications.push('No budget constraints specified - recommend setting at least one budget limit');
    }

    if (goal.description.length < 50) {
      clarifications.push('Goal description is very brief - may need more context for effective planning');
    }

    const hasParent = !!goal.parent_goal_id;
    if (hasParent) {
      const parent = this.repository.getGoal(goal.parent_goal_id!);
      if (!parent) {
        escalations.push(`Parent goal ${goal.parent_goal_id} does not exist`);
      } else if (parent.status === 'cancelled') {
        escalations.push(`Parent goal ${goal.parent_goal_id} is cancelled`);
      }
    }

    // Inject structured constraints from GoalIntent (if available)
    this.injectIntentConstraints(goal, clarifications);

    // Inject known constraints, pitfalls, and failure modes from global knowledge
    this.injectGlobalKnowledge(clarifications);

    // Suggest budgets based on historical time_estimate knowledge
    this.suggestBudgets(goal, clarifications);

    const updatedGoal = { ...goal };

    if (escalations.length > 0) {
      this.repository.updateGoalStatus(goal.id, 'blocked');

      for (const escalation of escalations) {
        this.repository.createEscalation({
          work_item_id: '',
          goal_id: goal.id,
          escalation_type: 'ambiguous',
          severity: 'high',
          title: 'Goal elaboration failed',
          description: escalation,
        });
      }
    } else if (clarifications.length === 0) {
      this.repository.updateGoalStatus(goal.id, 'active');
    }

    return {
      goal: updatedGoal,
      clarifications,
      escalations,
    };
  }

  /**
   * Inject structured constraint blocks from GoalIntent (extracted during intake).
   * Reads goal.context.intent — does NOT call LLM.
   */
  private injectIntentConstraints(goal: Goal, clarifications: string[]): void {
    const intent = goal.context?.intent as GoalIntent | undefined;
    if (!intent?.extracted_constraints || intent.extracted_constraints.length === 0) {
      return;
    }

    const constraints = intent.extracted_constraints;
    const constraintLines = constraints.map(
      (c: ExtractedConstraint) => `- [${c.type}] ${c.description} (confidence: ${c.confidence.toFixed(2)})`
    );

    let block = 'TASK CONSTRAINTS (extracted before planning began):\n' + constraintLines.join('\n');

    // Append scope boundary if present
    if (intent.scope_boundary) {
      block += '\n\nSCOPE BOUNDARY:\n' + intent.scope_boundary;
    }

    clarifications.push(block);
  }

  /**
   * Inject known constraints, pitfalls, and failure modes from global knowledge.
   * Queries with type array, cap 10, minConfidence 0.5.
   */
  private injectGlobalKnowledge(clarifications: string[]): void {
    if (!this.globalKnowledge) {
      return;
    }

    try {
      const relevantKnowledge = this.globalKnowledge.getRelevantKnowledge({
        knowledgeType: ['pitfall', 'constraint', 'failure_mode'],
        limit: 10,
        minConfidence: 0.5,
      });

      if (relevantKnowledge.length > 0) {
        const lines = relevantKnowledge.map(
          k => `[${k.knowledge_type.toUpperCase()}] ${k.content} (confidence: ${k.confidence.toFixed(1)})`
        );
        clarifications.push(
          'KNOWN CONSTRAINTS AND PITFALLS:\n' + lines.join('\n')
        );
      }
    } catch {
      // global_knowledge table may not exist yet — graceful degradation
    }
  }

  /**
   * Suggest budgets based on historical time_estimate knowledge entries.
   * Advisory only — added to clarifications, not escalations.
   */
  private suggestBudgets(goal: Goal, clarifications: string[]): void {
    // Skip if budget is already set
    if (goal.budget_tokens) {
      return;
    }

    if (!this.globalKnowledge) {
      return;
    }

    try {
      const estimates = this.globalKnowledge.getRelevantKnowledge({
        knowledgeType: 'time_estimate',
        limit: 3,
        minConfidence: 0.6,
      });

      if (estimates.length > 0) {
        const estimateDescriptions = estimates.map(e => e.content).join('; ');
        clarifications.push(
          'Budget suggestion based on similar tasks: consider setting budget_tokens. ' +
          `Past similar tasks used approximately: ${estimateDescriptions}`
        );
      }
    } catch {
      // graceful degradation
    }
  }
}
