/**
 * Retry Handler
 * Manages retry strategies for failed tasks
 */

import type {
  RetryStrategy,
  IRetryAdjustment,
  IFailureAnalysis,
  IRetryContext,
} from '../../domain/conversation/retry.js';
import { RETRY_STRATEGY_ORDER, MAX_AUTO_RETRY_ATTEMPTS } from '../../domain/conversation/retry.js';
import type { LLMService } from '../../infra/llm/llm-service.js';

export interface IRetryHandler {
  analyzeFailure(
    errorMessage: string,
    context: IRetryContext
  ): Promise<IFailureAnalysis>;

  selectRetryStrategy(
    analysis: IFailureAnalysis,
    context: IRetryContext
  ): IRetryAdjustment | null;

  canAutoRetry(context: IRetryContext): boolean;
}

const FAILURE_ANALYSIS_PROMPT = `Analyze the following task failure and categorize it.

Error message:
{errorMessage}

Previous retry attempts: {attempts}
Previous strategies tried: {previousStrategies}

Respond with a JSON object:
{
  "errorType": "<one of: transient, resource, capability, permission, unknown>",
  "suggestedStrategies": ["<list of applicable retry strategies from: same_approach, parameter_adjust, alternative_tool, model_upgrade, decompose_further, human_guidance>"],
  "canAutoRetry": <true if automatic retry is safe>,
  "requiresUserInput": <true if user guidance is needed>,
  "reasoning": "<brief explanation>"
}

Error types:
- transient: Temporary issues (network, rate limit, timeout)
- resource: Missing resources (file not found, service unavailable)
- capability: Task beyond current capabilities
- permission: Access denied or authorization issues
- unknown: Cannot determine cause

Return ONLY the JSON object.`;

export class RetryHandler implements IRetryHandler {
  constructor(private llmService: LLMService) {}

  async analyzeFailure(
    errorMessage: string,
    context: IRetryContext
  ): Promise<IFailureAnalysis> {
    try {
      const prompt = FAILURE_ANALYSIS_PROMPT
        .replace('{errorMessage}', errorMessage)
        .replace('{attempts}', context.attemptNumber.toString())
        .replace('{previousStrategies}', context.previousStrategies.join(', ') || 'none');

      const response = await this.llmService.completeWithTier(
        [{ role: 'user', content: prompt }],
        'simple',
        { maxTokens: 500 }
      );

      const jsonMatch = (response.content || '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.fallbackAnalysis(errorMessage);
      }

      const result = JSON.parse(jsonMatch[0]);

      return {
        errorType: this.normalizeErrorType(result.errorType),
        errorMessage,
        suggestedStrategies: this.normalizeStrategies(result.suggestedStrategies),
        canAutoRetry: result.canAutoRetry ?? false,
        requiresUserInput: result.requiresUserInput ?? true,
      };
    } catch {
      return this.fallbackAnalysis(errorMessage);
    }
  }

  selectRetryStrategy(
    analysis: IFailureAnalysis,
    context: IRetryContext
  ): IRetryAdjustment | null {
    // If we've exhausted auto-retry attempts, require human guidance
    if (!this.canAutoRetry(context)) {
      if (!context.previousStrategies.includes('human_guidance')) {
        return {
          strategy: 'human_guidance',
          description: 'Automatic retry attempts exhausted. Requesting user guidance.',
        };
      }
      return null;
    }

    // Find the next strategy that hasn't been tried
    for (const strategy of analysis.suggestedStrategies) {
      if (!context.previousStrategies.includes(strategy)) {
        return this.buildAdjustment(strategy, analysis);
      }
    }

    // Fall back to strategy order
    for (const strategy of RETRY_STRATEGY_ORDER) {
      if (!context.previousStrategies.includes(strategy)) {
        return this.buildAdjustment(strategy, analysis);
      }
    }

    return null;
  }

  canAutoRetry(context: IRetryContext): boolean {
    return (
      context.attemptNumber < MAX_AUTO_RETRY_ATTEMPTS &&
      !context.previousStrategies.includes('human_guidance')
    );
  }

  private buildAdjustment(
    strategy: RetryStrategy,
    analysis: IFailureAnalysis
  ): IRetryAdjustment {
    const descriptions: Record<RetryStrategy, string> = {
      same_approach: 'Retrying with the same approach (transient error).',
      parameter_adjust: 'Adjusting parameters to avoid the error.',
      alternative_tool: 'Trying an alternative tool or method.',
      model_upgrade: 'Using a more capable model for this task.',
      decompose_further: 'Breaking the task into smaller, more manageable steps.',
      human_guidance: 'Requesting user guidance on how to proceed.',
    };

    const adjustment: IRetryAdjustment = {
      strategy,
      description: descriptions[strategy],
    };

    // Add strategy-specific changes
    switch (strategy) {
      case 'parameter_adjust':
        adjustment.changes = { timeout_multiplier: 2, max_retries: 1 };
        break;
      case 'model_upgrade':
        adjustment.changes = { tier: 'complex' };
        break;
      case 'decompose_further':
        adjustment.changes = { split_into_subtasks: true };
        break;
    }

    return adjustment;
  }

  private normalizeErrorType(
    type: string
  ): IFailureAnalysis['errorType'] {
    const validTypes: IFailureAnalysis['errorType'][] = [
      'transient', 'resource', 'capability', 'permission', 'unknown',
    ];
    return validTypes.includes(type as IFailureAnalysis['errorType'])
      ? (type as IFailureAnalysis['errorType'])
      : 'unknown';
  }

  private normalizeStrategies(strategies: unknown): RetryStrategy[] {
    if (!Array.isArray(strategies)) {
      return ['same_approach'];
    }
    return strategies.filter((s): s is RetryStrategy =>
      RETRY_STRATEGY_ORDER.includes(s as RetryStrategy)
    );
  }

  private fallbackAnalysis(errorMessage: string): IFailureAnalysis {
    const lowerError = errorMessage.toLowerCase();

    let errorType: IFailureAnalysis['errorType'] = 'unknown';
    let suggestedStrategies: RetryStrategy[] = ['same_approach'];

    if (/timeout|timed out|ETIMEDOUT/i.test(lowerError)) {
      errorType = 'transient';
      suggestedStrategies = ['same_approach', 'parameter_adjust'];
    } else if (/rate limit|429|too many requests/i.test(lowerError)) {
      errorType = 'transient';
      suggestedStrategies = ['same_approach', 'parameter_adjust'];
    } else if (/not found|404|ENOENT/i.test(lowerError)) {
      errorType = 'resource';
      suggestedStrategies = ['alternative_tool', 'human_guidance'];
    } else if (/permission|denied|unauthorized|403|401/i.test(lowerError)) {
      errorType = 'permission';
      suggestedStrategies = ['human_guidance'];
    } else if (/cannot|unable|failed to/i.test(lowerError)) {
      errorType = 'capability';
      suggestedStrategies = ['model_upgrade', 'decompose_further', 'alternative_tool'];
    }

    return {
      errorType,
      errorMessage,
      suggestedStrategies,
      canAutoRetry: errorType === 'transient',
      requiresUserInput: errorType === 'permission' || errorType === 'unknown',
    };
  }
}
