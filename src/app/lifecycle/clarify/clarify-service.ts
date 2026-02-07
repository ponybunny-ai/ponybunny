/**
 * Clarify Service
 *
 * Analyzes goals to determine if clarification is needed,
 * generates clarification questions, and processes responses.
 */

import { randomUUID } from 'node:crypto';

import type {
  IClarifyService,
  IClarificationResult,
  IClarificationQuestion,
  IClarificationResponse,
  IClarificationState,
  ClarificationCategory,
} from '../../../domain/clarify/types.js';

// ============================================================================
// Clarification Patterns
// ============================================================================

/**
 * Patterns that indicate ambiguity in goal descriptions
 */
const AMBIGUITY_PATTERNS = [
  { pattern: /\b(some|several|many|few|various)\b/i, category: 'scope' as const },
  { pattern: /\b(etc\.?|and so on|and more)\b/i, category: 'scope' as const },
  { pattern: /\b(maybe|perhaps|possibly|might|could)\b/i, category: 'requirements' as const },
  { pattern: /\b(appropriate|suitable|proper|good)\b/i, category: 'requirements' as const },
  { pattern: /\b(soon|later|eventually|when possible)\b/i, category: 'constraints' as const },
  { pattern: /\b(fast|quick|efficient|performant)\b/i, category: 'constraints' as const },
  { pattern: /\b(simple|easy|straightforward)\b/i, category: 'approach' as const },
  { pattern: /\b(better|improve|enhance|optimize)\b/i, category: 'success_criteria' as const },
  { pattern: /\b(if needed|if necessary|as required)\b/i, category: 'scope' as const },
];

/**
 * Keywords that suggest missing information
 */
const MISSING_INFO_KEYWORDS = [
  { keyword: 'api', questions: ['What API endpoints are involved?', 'What is the API authentication method?'] },
  { keyword: 'database', questions: ['Which database system?', 'What is the schema structure?'] },
  { keyword: 'authentication', questions: ['What authentication method?', 'What are the security requirements?'] },
  { keyword: 'deploy', questions: ['What is the deployment target?', 'What are the environment requirements?'] },
  { keyword: 'test', questions: ['What types of tests are needed?', 'What is the coverage requirement?'] },
  { keyword: 'integration', questions: ['What systems need to be integrated?', 'What are the data formats?'] },
];

// ============================================================================
// Clarify Service Implementation
// ============================================================================

export class ClarifyService implements IClarifyService {
  private states = new Map<string, IClarificationState>();

  /**
   * Analyze a goal and determine if clarification is needed
   */
  async analyzeGoal(goal: {
    title: string;
    description: string;
    success_criteria: Array<{ description: string }>;
  }): Promise<IClarificationResult> {
    const text = `${goal.title} ${goal.description} ${goal.success_criteria.map(c => c.description).join(' ')}`;

    // Check for ambiguity patterns
    const ambiguousAreas: string[] = [];
    const categorySet = new Set<ClarificationCategory>();

    for (const { pattern, category } of AMBIGUITY_PATTERNS) {
      if (pattern.test(text)) {
        ambiguousAreas.push(pattern.source);
        categorySet.add(category);
      }
    }

    // Calculate confidence based on various factors
    let confidence = 1.0;

    // Reduce confidence for short descriptions
    if (goal.description.length < 50) {
      confidence -= 0.2;
      ambiguousAreas.push('description_too_short');
    }

    // Reduce confidence for missing success criteria
    if (goal.success_criteria.length === 0) {
      confidence -= 0.3;
      ambiguousAreas.push('no_success_criteria');
      categorySet.add('success_criteria');
    }

    // Reduce confidence for ambiguity patterns found
    confidence -= ambiguousAreas.length * 0.1;
    confidence = Math.max(0, Math.min(1, confidence));

    // Generate questions if clarification needed
    const needsClarification = confidence < 0.7;
    let questions: IClarificationQuestion[] = [];

    if (needsClarification) {
      questions = await this.generateQuestions(goal, Array.from(categorySet));
    }

    return {
      needsClarification,
      confidence,
      questions,
      reasoning: needsClarification
        ? `Goal clarity score: ${(confidence * 100).toFixed(0)}%. Found ${ambiguousAreas.length} areas needing clarification.`
        : undefined,
      ambiguousAreas: ambiguousAreas.length > 0 ? ambiguousAreas : undefined,
    };
  }

  /**
   * Generate clarification questions for a goal
   */
  async generateQuestions(
    goal: { title: string; description: string },
    categories?: ClarificationCategory[]
  ): Promise<IClarificationQuestion[]> {
    const questions: IClarificationQuestion[] = [];
    const text = `${goal.title} ${goal.description}`.toLowerCase();

    // Add category-specific questions
    if (!categories || categories.includes('scope')) {
      if (text.includes('and') || text.includes('also')) {
        questions.push({
          id: randomUUID(),
          question: 'Can you list all the specific features/components that should be included?',
          type: 'text',
          required: true,
          context: 'This helps define the exact scope of work.',
        });
      }
    }

    if (!categories || categories.includes('success_criteria')) {
      questions.push({
        id: randomUUID(),
        question: 'How will you verify that this goal is successfully completed?',
        type: 'text',
        required: true,
        context: 'Specific, measurable criteria help ensure the work meets expectations.',
      });
    }

    if (!categories || categories.includes('constraints')) {
      questions.push({
        id: randomUUID(),
        question: 'Are there any specific technology constraints or requirements?',
        type: 'text',
        required: false,
        context: 'e.g., specific frameworks, languages, or compatibility requirements',
      });
    }

    if (!categories || categories.includes('priority')) {
      questions.push({
        id: randomUUID(),
        question: 'What is the priority of this task?',
        type: 'choice',
        required: true,
        options: ['Critical - Must be done ASAP', 'High - Important but not urgent', 'Medium - Normal priority', 'Low - Nice to have'],
      });
    }

    // Add keyword-based questions
    for (const { keyword, questions: keywordQuestions } of MISSING_INFO_KEYWORDS) {
      if (text.includes(keyword)) {
        for (const q of keywordQuestions) {
          questions.push({
            id: randomUUID(),
            question: q,
            type: 'text',
            required: false,
            context: `Related to: ${keyword}`,
          });
        }
      }
    }

    // Limit to most relevant questions
    return questions.slice(0, 5);
  }

  /**
   * Process clarification responses and update goal
   */
  async processResponses(
    goalId: string,
    responses: IClarificationResponse[]
  ): Promise<{
    updatedDescription?: string;
    updatedCriteria?: Array<{ description: string }>;
    additionalContext?: Record<string, unknown>;
  }> {
    const state = this.states.get(goalId);
    if (!state) {
      throw new Error(`No clarification state found for goal: ${goalId}`);
    }

    // Store responses
    state.responses = responses;
    state.status = 'completed';
    state.completedAt = Date.now();

    // Build additional context from responses
    const additionalContext: Record<string, unknown> = {};
    const updatedCriteria: Array<{ description: string }> = [];

    for (const response of responses) {
      const question = state.questions.find(q => q.id === response.questionId);
      if (!question) continue;

      // Extract success criteria from relevant responses
      if (question.question.toLowerCase().includes('verify') ||
          question.question.toLowerCase().includes('success')) {
        if (typeof response.value === 'string' && response.value.trim()) {
          updatedCriteria.push({
            description: response.value.trim(),
          });
        }
      }

      // Store other responses as context
      additionalContext[question.question] = response.value;
    }

    return {
      updatedCriteria: updatedCriteria.length > 0 ? updatedCriteria : undefined,
      additionalContext: Object.keys(additionalContext).length > 0 ? additionalContext : undefined,
    };
  }

  /**
   * Check if all required questions have been answered
   */
  isComplete(state: IClarificationState): boolean {
    const requiredQuestions = state.questions.filter(q => q.required);
    const answeredIds = new Set(state.responses.map(r => r.questionId));

    return requiredQuestions.every(q => answeredIds.has(q.id));
  }

  /**
   * Get the clarification state for a goal
   */
  async getState(goalId: string): Promise<IClarificationState | null> {
    return this.states.get(goalId) ?? null;
  }

  /**
   * Initialize clarification state for a goal
   */
  async initializeState(
    goalId: string,
    questions: IClarificationQuestion[]
  ): Promise<IClarificationState> {
    const state: IClarificationState = {
      goalId,
      status: questions.length > 0 ? 'pending' : 'completed',
      questions,
      responses: [],
      startedAt: Date.now(),
      completedAt: questions.length === 0 ? Date.now() : undefined,
    };

    this.states.set(goalId, state);
    return state;
  }

  /**
   * Update state with user responses
   */
  async addResponses(
    goalId: string,
    responses: IClarificationResponse[]
  ): Promise<IClarificationState> {
    const state = this.states.get(goalId);
    if (!state) {
      throw new Error(`No clarification state found for goal: ${goalId}`);
    }

    // Add new responses
    for (const response of responses) {
      const existingIndex = state.responses.findIndex(r => r.questionId === response.questionId);
      if (existingIndex >= 0) {
        state.responses[existingIndex] = response;
      } else {
        state.responses.push(response);
      }
    }

    // Update status
    state.status = 'in_progress';
    if (this.isComplete(state)) {
      state.status = 'completed';
      state.completedAt = Date.now();
    }

    return state;
  }

  /**
   * Skip clarification for a goal
   */
  async skip(goalId: string, reason: string): Promise<void> {
    let state = this.states.get(goalId);

    if (!state) {
      state = {
        goalId,
        status: 'skipped',
        questions: [],
        responses: [],
        skippedReason: reason,
      };
      this.states.set(goalId, state);
    } else {
      state.status = 'skipped';
      state.skippedReason = reason;
      state.completedAt = Date.now();
    }
  }

  /**
   * Clear state for a goal
   */
  clearState(goalId: string): void {
    this.states.delete(goalId);
  }
}
