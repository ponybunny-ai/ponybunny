import type { LLMMessage } from '../../../infra/llm/llm-provider.js';
import type { LLMService } from '../../../infra/llm/llm-service.js';
import type {
  AgentADetectRequest,
  AgentADetectResult,
  AgentAExtractRequest,
  AgentAExtractResult,
  AgentARoleResult,
  AgentADetectLabel,
  AgentARoleGuess,
  AgentALimitsConfig,
} from './types.js';
import { getDetectSystemPrompt, getExtractSystemPrompt, getRoleSystemPrompt } from './prompts.js';

const AGENT_ID = 'agent_a_market_listener';

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function normalizeMarkers(markers: string[], limits: AgentALimitsConfig): string[] {
  const normalized = markers
    .map(marker => marker.trim())
    .filter(marker => marker.length > 0)
    .map(marker => marker.split(/\s+/).slice(0, 20).join(' '));

  return normalized.slice(0, limits.signal_markers_max_items);
}

function clampConfidence(value: number, maxValue = 1): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > maxValue) return maxValue;
  return value;
}

export class AgentALLMHelper {
  constructor(private llmService: LLMService, private limits: AgentALimitsConfig) {}

  async detectProblemSignal(request: AgentADetectRequest): Promise<AgentADetectResult> {
    const systemPrompt = getDetectSystemPrompt();
    const userPrompt = `Classify if the text contains a user-expressed problem/pain/need.
Return JSON with:
{
  "has_problem_signal": boolean,
  "signal_markers": string[],
  "label": "problem"|"how_to"|"bug"|"request"|"complaint"|"discussion"|"showcase"|"other",
  "confidence": number
}
Rules:
- signal_markers must be verbatim snippets (<=20 words each).
- If uncertain, still return your best guess.

Text:
${request.raw_text}`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llmService.completeForAgent(AGENT_ID, messages, {
      maxTokens: 400,
      temperature: 0.1,
    });

    const parsed = safeJsonParse<AgentADetectResult>(response.content || '');

    if (!parsed) {
      return {
        has_problem_signal: this.heuristicDetect(request.raw_text),
        signal_markers: [],
        label: 'other',
        confidence: 0,
      };
    }

    const confidence = clampConfidence(parsed.confidence ?? 0);
    const hasProblem = parsed.has_problem_signal ?? false;
    const label = (parsed.label ?? 'other') as AgentADetectLabel;
    const markers = normalizeMarkers(parsed.signal_markers || [], this.limits);

    const shouldCapture = (confidence >= 0.45 && confidence <= 0.55) ? true : hasProblem;

    return {
      has_problem_signal: shouldCapture,
      signal_markers: markers,
      label,
      confidence,
    };
  }

  async extractProblemBlock(request: AgentAExtractRequest): Promise<AgentAExtractResult> {
    const systemPrompt = getExtractSystemPrompt();
    const userPrompt = `Extract the smallest useful verbatim block that represents the problem, plus minimal context.
Return JSON with:
{
  "problem_raw_text": string,
  "surrounding_context": string,
  "mentioned_tools": string[],
  "constraints": string[]
}
Rules:
- No paraphrase. Verbatim only.
- Do not clean grammar.
- If raw_text is short, problem_raw_text may equal raw_text.

Text:
${request.raw_text}`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llmService.completeForAgent(AGENT_ID, messages, {
      maxTokens: 800,
      temperature: 0.1,
    });

    const parsed = safeJsonParse<AgentAExtractResult>(response.content || '');
    if (!parsed) {
      return {
        problem_raw_text: request.raw_text,
        surrounding_context: '',
        mentioned_tools: [],
        constraints: [],
        extraction_fallback: true,
      };
    }

    return {
      problem_raw_text: parsed.problem_raw_text ?? request.raw_text,
      surrounding_context: parsed.surrounding_context ?? '',
      mentioned_tools: parsed.mentioned_tools ?? [],
      constraints: parsed.constraints ?? [],
    };
  }

  async guessAuthorRole(rawText: string): Promise<AgentARoleResult> {
    const systemPrompt = getRoleSystemPrompt();
    const userPrompt = `Guess the author role based on the text.
Return JSON with:
{
  "role_guess": "founder"|"employee"|"developer"|"ops"|"student"|"hobbyist"|"unknown",
  "confidence": number
}
Rules:
- Confidence must be <= 0.5
- If uncertain, return unknown with confidence 0.1

Text:
${rawText}`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llmService.completeForAgent(AGENT_ID, messages, {
      maxTokens: 200,
      temperature: 0.1,
    });

    const parsed = safeJsonParse<AgentARoleResult>(response.content || '');
    if (!parsed) {
      return { role_guess: 'unknown', confidence: 0.1 };
    }

    const role = (parsed.role_guess ?? 'unknown') as AgentARoleGuess;
    const confidence = clampConfidence(parsed.confidence ?? 0.1, 0.5);

    if (confidence === 0) {
      return { role_guess: 'unknown', confidence: 0.1 };
    }

    return { role_guess: role, confidence };
  }

  private heuristicDetect(text: string): boolean {
    const lower = text.toLowerCase();
    return [
      'how do i',
      'how can i',
      'problem',
      'issue',
      'bug',
      'error',
      'help',
      'need',
      'struggling',
      'doesn\'t work',
    ].some(keyword => lower.includes(keyword));
  }
}
