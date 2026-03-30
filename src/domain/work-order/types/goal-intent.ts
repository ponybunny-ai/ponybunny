/**
 * GoalIntent — Domain type for intent classification of incoming goals.
 *
 * Produced by IntentClassificationService during the intake phase (step 0)
 * of GoalHarness.elaboratePlanDelegate(). Persisted to goal.context.intent.
 *
 * The GOAL_INTENT_SCHEMA is an AJV-compatible JSON Schema used for
 * runtime validation of LLM output before accepting it as GoalIntent.
 */

export type TaskType =
  | 'code_implementation'
  | 'code_refactoring'
  | 'code_review'
  | 'test_writing'
  | 'documentation'
  | 'analysis'
  | 'research'
  | 'configuration'
  | 'debugging'
  | 'migration'
  | 'unknown';

export interface ExtractedConstraint {
  description: string;
  type:
    | 'must_not_break'
    | 'style_requirement'
    | 'scope_limit'
    | 'external_dependency'
    | 'performance'
    | 'other';
  confidence: number;
}

export interface GoalIntent {
  task_type: TaskType;
  domain_tags: string[];
  extracted_constraints: ExtractedConstraint[];
  scope_boundary: string;
  classification_confidence: number;
  clarification_questions?: string[];
}

/**
 * AJV JSON Schema for runtime validation of LLM-produced GoalIntent.
 *
 * The schema enforces:
 *  - task_type is one of the known TaskType enum values
 *  - domain_tags is a non-empty array of strings
 *  - extracted_constraints items match ExtractedConstraint shape
 *  - classification_confidence is in [0, 1]
 *  - clarification_questions is optional array of strings
 */
export const GOAL_INTENT_SCHEMA = {
  type: 'object',
  required: [
    'task_type',
    'domain_tags',
    'extracted_constraints',
    'scope_boundary',
    'classification_confidence',
  ],
  properties: {
    task_type: {
      type: 'string',
      enum: [
        'code_implementation',
        'code_refactoring',
        'code_review',
        'test_writing',
        'documentation',
        'analysis',
        'research',
        'configuration',
        'debugging',
        'migration',
        'unknown',
      ],
    },
    domain_tags: {
      type: 'array',
      items: { type: 'string' },
    },
    extracted_constraints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'type', 'confidence'],
        properties: {
          description: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'must_not_break',
              'style_requirement',
              'scope_limit',
              'external_dependency',
              'performance',
              'other',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        additionalProperties: false,
      },
    },
    scope_boundary: { type: 'string' },
    classification_confidence: { type: 'number', minimum: 0, maximum: 1 },
    clarification_questions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: false,
} as const;
