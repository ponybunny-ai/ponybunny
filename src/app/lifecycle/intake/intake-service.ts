import type { IIntakeService, IntakeResult, GoalRequest } from '../stage-interfaces.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import { validateGoalInvariants } from '../../../domain/work-order/invariants.js';

export class IntakeService implements IIntakeService {
  constructor(private repository: IWorkOrderRepository) {}

  async acceptGoal(request: GoalRequest): Promise<IntakeResult> {
    const criteriaWithDefaults = request.success_criteria?.map(c => ({
      ...c,
      required: c.required ?? true,
    })) || [
      {
        description: 'All work items completed successfully',
        type: 'deterministic' as const,
        verification_method: 'status_check',
        required: true,
      },
    ];

    const violations = validateGoalInvariants({
      title: request.title,
      description: request.description,
      success_criteria: criteriaWithDefaults,
      budget_tokens: request.budget_tokens,
    });
    
    if (violations.length > 0) {
      throw new Error(`Goal validation failed: ${violations.map(v => v.message).join(', ')}`);
    }

    const goal = this.repository.createGoal({
      title: request.title,
      description: request.description,
      success_criteria: criteriaWithDefaults,
      priority: request.priority ?? 50,
      budget_tokens: request.budget_tokens,
      budget_time_minutes: request.budget_time_minutes,
    });

    const needsElaboration = 
      !request.success_criteria ||
      request.success_criteria.length === 0 ||
      request.description.length < 50;

    return {
      goal,
      needsElaboration,
    };
  }
}
