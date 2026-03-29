/**
 * ProgressDetector — detects when a ReAct loop is no longer making progress.
 *
 * Evaluates each LLM response to detect:
 *   - Consecutive empty responses (no tool calls, no content)
 *   - Repeated identical responses (stuck in a loop)
 *
 * Used by ReActIntegration to decide when to abort early rather than
 * burning through all max_iterations.
 */

import { createHash } from 'node:crypto';

export interface ProgressConfig {
  /** Max consecutive iterations with no tool calls and no content. Default: 3 */
  maxNoActionIterations: number;
}

export const DEFAULT_PROGRESS_CONFIG: ProgressConfig = {
  maxNoActionIterations: 3,
};

export interface ProgressAssessment {
  shouldAbort: boolean;
  reason?: 'no_action' | 'stuck_loop' | 'max_iterations';
  detail?: string;
}

export interface ResponseSignals {
  hasToolCalls: boolean;
  content: string | null;
}

export class ProgressDetector {
  private noActionCount = 0;
  private lastContentHash = '';

  evaluate(response: ResponseSignals, config: ProgressConfig = DEFAULT_PROGRESS_CONFIG): ProgressAssessment {
    const contentHash = response.content ? hashString(response.content) : '';
    const isRepeatedContent = contentHash !== '' && contentHash === this.lastContentHash;

    if (!response.hasToolCalls && !response.content) {
      this.noActionCount++;
    } else {
      this.noActionCount = 0;
    }
    this.lastContentHash = contentHash;

    if (this.noActionCount >= config.maxNoActionIterations) {
      return {
        shouldAbort: true,
        reason: 'no_action',
        detail: `${this.noActionCount} consecutive empty responses`,
      };
    }

    if (isRepeatedContent && !response.hasToolCalls) {
      return {
        shouldAbort: true,
        reason: 'stuck_loop',
        detail: 'Repeated identical response without tool calls',
      };
    }

    return { shouldAbort: false };
  }

  reset(): void {
    this.noActionCount = 0;
    this.lastContentHash = '';
  }
}

function hashString(s: string): string {
  return createHash('md5').update(s).digest('hex');
}
