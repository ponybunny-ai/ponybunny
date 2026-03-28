import type { Goal } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { GlobalKnowledgeService } from '../../../domain/knowledge/index.js';
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

    // Inject known pitfalls from global knowledge into clarifications
    // so the goal owner is aware of past failures relevant to this goal
    if (this.globalKnowledge) {
      try {
        const pitfalls = this.globalKnowledge.getRelevantKnowledge({
          knowledgeType: 'pitfall',
          limit: 5,
          minConfidence: 0.4,
        });
        if (pitfalls.length > 0) {
          const pitfallWarnings = pitfalls.map(
            p => `[Known pitfall, confidence ${p.confidence.toFixed(1)}]: ${p.content}`
          );
          clarifications.push(
            `Global knowledge contains ${pitfalls.length} relevant pitfall(s) from previous goals:\n` +
            pitfallWarnings.join('\n')
          );
        }
      } catch {
        // global_knowledge table may not exist yet — graceful degradation
      }
    }

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
}
