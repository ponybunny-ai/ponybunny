/**
 * Clarify Domain Types
 *
 * Types for the goal clarification phase.
 * This phase ensures requirements are clear before planning begins.
 */

// ============================================================================
// Clarification Question Types
// ============================================================================

export type ClarificationQuestionType =
  | 'text'           // Free-form text input
  | 'choice'         // Single choice from options
  | 'multi_choice'   // Multiple choices
  | 'confirmation'   // Yes/No confirmation
  | 'number'         // Numeric input
  | 'file_path';     // File or directory path

export interface IClarificationQuestion {
  id: string;
  question: string;
  type: ClarificationQuestionType;
  required: boolean;
  context?: string;           // Additional context for the question
  options?: string[];         // For choice/multi_choice types
  defaultValue?: unknown;
  validation?: {
    pattern?: string;         // Regex pattern
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
}

export interface IClarificationResponse {
  questionId: string;
  value: unknown;
  timestamp: number;
}

// ============================================================================
// Clarification Result
// ============================================================================

export interface IClarificationResult {
  needsClarification: boolean;
  confidence: number;         // 0-1, how clear the requirements are
  questions: IClarificationQuestion[];
  reasoning?: string;         // Why clarification is needed
  ambiguousAreas?: string[];  // Specific areas that are unclear
}

// ============================================================================
// Clarification Categories
// ============================================================================

export type ClarificationCategory =
  | 'scope'           // What is included/excluded
  | 'requirements'    // Technical requirements
  | 'constraints'     // Time, budget, technology constraints
  | 'dependencies'    // External dependencies
  | 'success_criteria'// How to measure success
  | 'priority'        // Priority and ordering
  | 'approach'        // Implementation approach
  | 'resources';      // Required resources/permissions

// ============================================================================
// Clarification State
// ============================================================================

export interface IClarificationState {
  goalId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  questions: IClarificationQuestion[];
  responses: IClarificationResponse[];
  startedAt?: number;
  completedAt?: number;
  skippedReason?: string;
}

// ============================================================================
// Clarify Service Interface
// ============================================================================

export interface IClarifyService {
  /**
   * Analyze a goal and determine if clarification is needed
   */
  analyzeGoal(goal: {
    title: string;
    description: string;
    success_criteria: Array<{ description: string }>;
  }): Promise<IClarificationResult>;

  /**
   * Generate clarification questions for a goal
   */
  generateQuestions(
    goal: { title: string; description: string },
    categories?: ClarificationCategory[]
  ): Promise<IClarificationQuestion[]>;

  /**
   * Process clarification responses and update goal
   */
  processResponses(
    goalId: string,
    responses: IClarificationResponse[]
  ): Promise<{
    updatedDescription?: string;
    updatedCriteria?: Array<{ description: string }>;
    additionalContext?: Record<string, unknown>;
  }>;

  /**
   * Check if all required questions have been answered
   */
  isComplete(state: IClarificationState): boolean;

  /**
   * Get the clarification state for a goal
   */
  getState(goalId: string): Promise<IClarificationState | null>;

  /**
   * Skip clarification for a goal
   */
  skip(goalId: string, reason: string): Promise<void>;
}
