import type { LLMService } from '../../infra/llm/llm-service.js';

import type { ICoreMemorySummaryService } from './memory-service.js';

const SUMMARY_PROMPT = `You summarize conversation turns into durable core memory.
Return strict JSON only with this schema:
{"summary":"string <= 160 chars","importance": number between 0 and 1}
Rules:
- Keep essential facts, decisions, constraints, preferences, commitments.
- Remove filler and tone-only content.
- importance is higher for constraints/deadlines/decisions.
`;

export class CoreMemorySummaryService implements ICoreMemorySummaryService {
  constructor(private llmService: LLMService) {}

  async summarize(input: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    ownerScope: { ownerType: 'agent' | 'user'; ownerId: string };
    preferredModel?: string;
  }): Promise<{ summary: string; importance: number }> {
    const response = await this.llmService.completeForWorkload(
      'conversation',
      [
        { role: 'system', content: SUMMARY_PROMPT },
        {
          role: 'user',
          content:
            `session=${input.sessionId}\nrole=${input.role}\nownerType=${input.ownerScope.ownerType}` +
            `\nownerId=${input.ownerScope.ownerId}\ncontent=${input.content}`,
        },
      ],
      {
        maxTokens: 220,
        ...(input.preferredModel ? { model: input.preferredModel } : {}),
      }
    );

    const text = response.content || '';
    const parsed = parseSummaryPayload(text);
    if (parsed) {
      return parsed;
    }

    return {
      summary: fallbackSummary(input.content),
      importance: fallbackImportance(input.content),
    };
  }
}

function parseSummaryPayload(value: string): { summary: string; importance: number } | null {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]) as { summary?: unknown; importance?: unknown };
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const importanceRaw = typeof parsed.importance === 'number' ? parsed.importance : Number(parsed.importance);
    if (summary.length === 0 || !Number.isFinite(importanceRaw)) {
      return null;
    }

    const compact = summary.length > 160 ? `${summary.slice(0, 160)}...` : summary;
    return {
      summary: compact,
      importance: Math.min(1, Math.max(0, importanceRaw)),
    };
  } catch {
    return null;
  }
}

function fallbackSummary(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 160)}...` : compact;
}

function fallbackImportance(value: string): number {
  const normalized = value.toLowerCase();
  let score = 0.45;
  if (/must|important|critical|deadline|urgent|需要|必须|关键/.test(normalized)) {
    score += 0.3;
  }
  if (value.length > 160) {
    score += 0.15;
  }
  return Math.min(1, Math.max(0, score));
}
