/**
 * IntentClassificationService — Classifies incoming goals by task type,
 * domain, constraints, and scope before elaboration.
 *
 * Called as step 0 in GoalHarness.elaboratePlanDelegate() when present.
 * Uses LLM with workload 'intent-classification' and validates output
 * against GOAL_INTENT_SCHEMA via AJV.
 *
 * On AJV validation failure: returns a safe fallback GoalIntent
 *   (task_type='unknown', confidence=0.0).
 * On LLM error: throws — GoalHarness handles transition to 'blocked'.
 */

import Ajv from 'ajv';
import type { ILLMService } from '../../../infra/llm/llm-service.interface.js';
import type { ILogger } from '../../../infra/observability/logger.js';
import type { Goal } from '../../../work-order/types/index.js';
import type { GoalIntent } from '../../../domain/work-order/types/goal-intent.js';
import { GOAL_INTENT_SCHEMA } from '../../../domain/work-order/types/goal-intent.js';

export const CLARIFICATION_THRESHOLD = 0.75;

const SYSTEM_PROMPT = `You are a goal intent classifier for an automated agent system.

Analyze the provided goal and produce a JSON object with this exact structure:
{
  "task_type": one of: "code_implementation", "code_refactoring", "code_review", "test_writing", "documentation", "analysis", "research", "configuration", "debugging", "migration", "unknown",
  "domain_tags": array of strings describing the domain areas (e.g., ["database", "api", "frontend"]),
  "extracted_constraints": array of constraint objects, each with:
    - "description": string describing the constraint
    - "type": one of: "must_not_break", "style_requirement", "scope_limit", "external_dependency", "performance", "other"
    - "confidence": number 0-1 for how confident you are this constraint exists
  "scope_boundary": string describing what is in scope and what is out of scope,
  "classification_confidence": number 0-1 for overall classification confidence,
  "clarification_questions": optional array of questions if the goal is ambiguous
}

Output ONLY valid JSON. No markdown, no explanation, no code fences.`;

export class IntentClassificationService {
  private readonly ajv: Ajv;
  private readonly validate: ReturnType<Ajv['compile']>;

  constructor(
    private readonly llmService: ILLMService,
    private readonly logger: ILogger,
  ) {
    this.ajv = new Ajv({ allErrors: true });
    this.validate = this.ajv.compile(GOAL_INTENT_SCHEMA);
  }

  async classify(goal: Goal): Promise<GoalIntent> {
    this.logger.info(
      { goalId: goal.id, event: 'intent_classification_start' },
      `Classifying intent for goal: ${goal.id}`,
    );

    const userPrompt = this.buildUserPrompt(goal);

    // LLM errors propagate to caller (GoalHarness handles transition to blocked)
    const response = await this.llmService.complete(
      'intent-classification',
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.1 },
    );

    const rawContent = response.content ?? '';

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      this.logger.warn(
        { goalId: goal.id, event: 'intent_classification_parse_failure' },
        `LLM returned non-JSON for intent classification of goal ${goal.id}`,
      );
      return this.fallbackIntent(goal.id);
    }

    const valid = this.validate(parsed);
    if (!valid) {
      this.logger.warn(
        {
          goalId: goal.id,
          event: 'intent_classification_validation_failure',
          errors: JSON.stringify(this.validate.errors),
        },
        `LLM output failed GoalIntent schema validation for goal ${goal.id}`,
      );
      return this.fallbackIntent(goal.id);
    }

    const intent = parsed as GoalIntent;

    this.logger.info(
      {
        goalId: goal.id,
        event: 'intent_classification_complete',
        taskType: intent.task_type,
        confidence: intent.classification_confidence,
      },
      `Intent classified for goal ${goal.id}: ${intent.task_type} (confidence: ${intent.classification_confidence})`,
    );

    return intent;
  }

  private buildUserPrompt(goal: Goal): string {
    const parts: string[] = [
      `Title: ${goal.title}`,
      `Description: ${goal.description}`,
    ];

    if (goal.success_criteria && goal.success_criteria.length > 0) {
      const criteriaText = goal.success_criteria
        .map((c, i) => `  ${i + 1}. ${c.description} (${c.type}, ${c.verification_method})`)
        .join('\n');
      parts.push(`Success Criteria:\n${criteriaText}`);
    }

    return parts.join('\n\n');
  }

  private fallbackIntent(goalId: string): GoalIntent {
    this.logger.info(
      { goalId, event: 'intent_classification_fallback' },
      `Using fallback intent for goal ${goalId}`,
    );
    return {
      task_type: 'unknown',
      domain_tags: [],
      extracted_constraints: [],
      scope_boundary: '',
      classification_confidence: 0.0,
      clarification_questions: ['Could not classify goal intent. Please provide more details.'],
    };
  }
}
