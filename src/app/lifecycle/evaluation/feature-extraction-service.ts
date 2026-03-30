/**
 * FeatureExtractionService — LLM-based knowledge extraction from GoalEvaluationReports.
 *
 * Called by HarnessDaemon (via onReport callback on PostGoalEvaluator) after
 * a goal evaluation completes. Uses an LLM to extract structured knowledge
 * entries from the evaluation report + ContextPack, then records them into
 * GlobalKnowledgeService.
 *
 * Design constraints:
 * - PostGoalEvaluator does NOT call this service directly — HarnessDaemon wires
 *   the callback so LLM calls stay outside the evaluator.
 * - Fire-and-forget from HarnessDaemon's perspective — errors are logged, never rethrown.
 * - Entries with confidence < 0.5 or invalid knowledge_type are silently skipped.
 * - Content > 500 chars is silently skipped.
 * - Max 10 entries per extraction (LLM output capped).
 */

import type { ILLMService } from '../../../infra/llm/llm-service.interface.js';
import type { GlobalKnowledgeService } from '../../../domain/knowledge/global-knowledge-service.js';
import type { KnowledgeType } from '../../../domain/knowledge/global-knowledge-service.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { Goal, ContextSnapshot } from '../../../work-order/types/index.js';
import type { GoalEvaluationReport } from '../../../harness/post-goal-evaluator.js';
import type { GoalIntent } from '../../../domain/work-order/types/goal-intent.js';
import type { ILogger } from '../../../infra/observability/logger.js';

// ---------------------------------------------------------------------------
// Valid knowledge types (must match KnowledgeType union)
// ---------------------------------------------------------------------------

const VALID_KNOWLEDGE_TYPES = new Set<string>([
  'constraint',
  'failure_mode',
  'pattern',
  'pitfall',
  'approach',
  'time_estimate',
  'tool_preference',
]);

// ---------------------------------------------------------------------------
// Extraction result shape (LLM output)
// ---------------------------------------------------------------------------

interface ExtractionResult {
  knowledge_type: string;
  scope?: string | null;
  content: string;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class FeatureExtractionService {
  constructor(
    private readonly llmService: ILLMService,
    private readonly knowledgeService: GlobalKnowledgeService,
    private readonly repository: IWorkOrderRepository,
    private readonly logger: ILogger,
  ) {}

  /**
   * Extract knowledge from a completed goal evaluation and record valid entries.
   * Returns the number of entries successfully recorded.
   */
  async extractAndRecord(report: GoalEvaluationReport, goal: Goal): Promise<number> {
    // 1. Fetch latest ContextPack
    const contextPack = this.repository.getLatestContextPack(goal.id);
    if (!contextPack) {
      this.logger.debug({ goalId: goal.id }, 'No ContextPack found — skipping feature extraction');
      return 0;
    }

    // 2. Get GoalIntent from goal context
    const intent = (goal.context?.intent as GoalIntent | undefined) ?? null;
    const domainTags = intent?.domain_tags ?? [];
    const scope = intent?.scope_boundary ?? null;

    // 3. Build extraction prompt
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(report, goal, contextPack.snapshot_data, intent);

    // 4. Call LLM
    let responseText: string;
    try {
      const response = await this.llmService.complete('feature-extraction', [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], { maxTokens: 2000, temperature: 0.3 });

      responseText = response.content ?? '';
    } catch (err) {
      this.logger.warn({ goalId: goal.id, err }, 'LLM call failed during feature extraction');
      return 0;
    }

    // 5. Parse and validate JSON
    let entries: ExtractionResult[];
    try {
      // Handle markdown fences that LLMs sometimes wrap JSON in
      const jsonStr = responseText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) {
        this.logger.warn({ goalId: goal.id }, 'LLM returned non-array — skipping');
        return 0;
      }
      entries = parsed.slice(0, 10); // Cap at 10 entries
    } catch {
      this.logger.warn({ goalId: goal.id }, 'LLM returned invalid JSON — skipping feature extraction');
      return 0;
    }

    // 6. Validate each entry and record
    let recorded = 0;

    for (const entry of entries) {
      if (!entry.knowledge_type || !VALID_KNOWLEDGE_TYPES.has(entry.knowledge_type)) continue;
      if (!entry.content || typeof entry.content !== 'string') continue;
      if (typeof entry.confidence !== 'number' || entry.confidence < 0.5) continue;
      if (entry.content.length > 500) continue;

      try {
        this.knowledgeService.record({
          knowledge_type: entry.knowledge_type as KnowledgeType,
          content: entry.content,
          scope: entry.scope ?? scope ?? undefined,
          domain_tags: domainTags,
          source_goal_id: goal.id,
          confidence: entry.confidence,
        });
        recorded++;
      } catch (err) {
        this.logger.warn({ goalId: goal.id, entry: entry.content }, 'Failed to record knowledge entry');
      }
    }

    if (recorded > 0) {
      this.logger.info(
        { goalId: goal.id, event: 'feature_extraction_complete', entriesWritten: recorded },
        `Feature extraction: ${recorded} entries recorded for goal ${goal.id}`,
      );
    }

    return recorded;
  }
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a knowledge extraction system for a software development agent harness.

Your task is to analyse a goal evaluation report and extract reusable knowledge entries.

Respond with ONLY a JSON array. No explanation, no markdown, no wrapping text.

Each array element must have:
- "knowledge_type": one of "constraint", "failure_mode", "pattern", "pitfall", "approach", "time_estimate", "tool_preference"
- "content": a concise description (max 500 characters)
- "confidence": a number between 0 and 1 indicating how confident you are this knowledge generalises
- "scope": (optional) a string describing the scope this applies to, or null

Rules:
- Extract only genuinely reusable insights, not restating the goal description
- Prefer higher confidence for patterns that recurred multiple times
- If there is nothing meaningful to extract, return an empty array []
- Maximum 10 entries
- Do NOT include entries you are less than 50% confident about`;
}

function buildUserPrompt(
  report: GoalEvaluationReport,
  goal: Goal,
  snapshot: ContextSnapshot,
  intent: GoalIntent | null,
): string {
  const sections: string[] = [];

  // Goal info
  sections.push(`## Goal
- ID: ${goal.id}
- Title: ${goal.title}
- Status trigger: ${report.trigger}
- Task type: ${intent?.task_type ?? 'unknown'}
- Domain tags: ${intent?.domain_tags?.join(', ') ?? 'none'}
- Scope: ${intent?.scope_boundary ?? 'unspecified'}`);

  // Work item results summary
  const { summary } = report;
  sections.push(`## Evaluation Summary
- Total work items: ${summary.total}
- Published: ${summary.publish}
- Retried: ${summary.retry}
- Replanned: ${summary.replan}
- Escalated: ${summary.escalate}
- Skipped: ${summary.skipped}`);

  // Work item details (abbreviated)
  if (report.workItemResults.length > 0) {
    const details = report.workItemResults.map(wi => {
      const decision = wi.evaluation?.decision ?? 'skipped';
      const reason = wi.evaluation?.reasoning ?? '';
      return `- ${wi.workItemId}: ${decision}${reason ? ` (${reason.slice(0, 200)})` : ''}`;
    }).join('\n');
    sections.push(`## Work Item Details\n${details}`);
  }

  // Execution summary from ContextPack
  const exec = snapshot.execution_summary;
  sections.push(`## Execution Summary
- Total runs: ${exec.total_runs}
- Successes: ${exec.success_count}
- Failures: ${exec.failure_count}`);

  if (exec.most_common_errors.length > 0) {
    const errors = exec.most_common_errors
      .map(e => `- ${e.signature} (x${e.count})`)
      .join('\n');
    sections.push(`## Common Errors\n${errors}`);
  }

  // Existing knowledge base from ContextPack
  const kb = snapshot.knowledge_base;
  if (kb.pitfalls_discovered.length > 0 || kb.learned_patterns.length > 0 || kb.successful_approaches.length > 0) {
    const kbLines: string[] = [];
    for (const p of kb.pitfalls_discovered) kbLines.push(`- Pitfall: ${p}`);
    for (const p of kb.learned_patterns) kbLines.push(`- Pattern: ${p}`);
    for (const a of kb.successful_approaches) kbLines.push(`- Approach: ${a}`);
    sections.push(`## Existing Knowledge Base\n${kbLines.join('\n')}`);
  }

  // Unactionable decisions
  if (report.unactionableDecisions.length > 0) {
    sections.push(`## Unactionable Decisions\n${report.unactionableDecisions.map(d => `- ${d}`).join('\n')}`);
  }

  return sections.join('\n\n');
}
