/**
 * Input Analysis Service
 * Analyzes user input for intent, emotion, and purpose extraction using LLM
 */

import type { LLMService } from '../../infra/llm/llm-service.js';
import type {
  IInputAnalysis,
  IIntentAnalysis,
  IEmotionAnalysis,
  IPurposeAnalysis,
  IntentCategory,
  EmotionalState,
  UrgencyLevel,
  IExtractedEntity,
} from '../../domain/conversation/analysis.js';
import type { IConversationTurn } from '../../domain/conversation/session.js';

export interface IInputAnalysisService {
  analyze(
    input: string,
    recentTurns?: IConversationTurn[]
  ): Promise<IInputAnalysis>;
}

interface LLMAnalysisResponse {
  intent: {
    primary: string;
    confidence: number;
    secondary?: string;
    entities: Array<{ type: string; value: string; confidence: number }>;
  };
  emotion: {
    primary: string;
    intensity: number;
    urgency: string;
  };
  purpose: {
    isActionable: boolean;
    extractedGoal?: string;
    missingInfo: string[];
    successCriteria?: string[];
    constraints?: string[];
  };
}

const ANALYSIS_SYSTEM_PROMPT = `You are an expert at analyzing user input to understand intent, emotion, and purpose.

Analyze the user's message and return a JSON object with the following structure:

{
  "intent": {
    "primary": "<one of: greeting, farewell, small_talk, task_request, question, status_inquiry, cancellation, confirmation, clarification, feedback, unknown>",
    "confidence": <0-1>,
    "secondary": "<optional secondary intent>",
    "entities": [{"type": "<entity type>", "value": "<extracted value>", "confidence": <0-1>}]
  },
  "emotion": {
    "primary": "<one of: neutral, happy, frustrated, confused, excited, anxious, grateful, disappointed>",
    "intensity": <0-1>,
    "urgency": "<one of: low, medium, high, critical>"
  },
  "purpose": {
    "isActionable": <true if this requires doing something>,
    "extractedGoal": "<what the user wants to achieve, if actionable>",
    "missingInfo": ["<list of missing information needed to proceed>"],
    "successCriteria": ["<list of success criteria if extractable>"],
    "constraints": ["<list of constraints mentioned>"]
  }
}

Be precise and consider the conversation context. Return ONLY the JSON object.`;

export class InputAnalysisService implements IInputAnalysisService {
  constructor(private llmService: LLMService) {}

  async analyze(
    input: string,
    recentTurns: IConversationTurn[] = []
  ): Promise<IInputAnalysis> {
    const contextMessages = this.buildContextMessages(input, recentTurns);

    try {
      const response = await this.llmService.completeWithTier(
        contextMessages,
        'simple',
        { maxTokens: 1000 }
      );

      const analysisResult = this.parseAnalysisResponse(response.content);

      return {
        intent: this.normalizeIntent(analysisResult.intent),
        emotion: this.normalizeEmotion(analysisResult.emotion),
        purpose: analysisResult.purpose,
        rawInput: input,
        analyzedAt: Date.now(),
      };
    } catch (error) {
      // Fallback to basic analysis on LLM failure
      return this.fallbackAnalysis(input);
    }
  }

  private buildContextMessages(
    input: string,
    recentTurns: IConversationTurn[]
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    ];

    // Add recent conversation context
    if (recentTurns.length > 0) {
      const contextSummary = recentTurns
        .slice(-5)
        .map(t => `${t.role}: ${t.content.slice(0, 200)}`)
        .join('\n');

      messages.push({
        role: 'user',
        content: `Recent conversation:\n${contextSummary}\n\nNow analyze this new message:\n"${input}"`,
      });
    } else {
      messages.push({
        role: 'user',
        content: `Analyze this message:\n"${input}"`,
      });
    }

    return messages;
  }

  private parseAnalysisResponse(content: string): LLMAnalysisResponse {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    return JSON.parse(jsonMatch[0]) as LLMAnalysisResponse;
  }

  private normalizeIntent(intent: LLMAnalysisResponse['intent']): IIntentAnalysis {
    const validIntents: IntentCategory[] = [
      'greeting', 'farewell', 'small_talk', 'task_request', 'question',
      'status_inquiry', 'cancellation', 'confirmation', 'clarification',
      'feedback', 'unknown',
    ];

    const primary = validIntents.includes(intent.primary as IntentCategory)
      ? (intent.primary as IntentCategory)
      : 'unknown';

    const entities: IExtractedEntity[] = (intent.entities || []).map(e => ({
      type: e.type,
      value: e.value,
      confidence: e.confidence,
    }));

    return {
      primary,
      confidence: Math.max(0, Math.min(1, intent.confidence || 0.5)),
      secondary: intent.secondary as IntentCategory | undefined,
      entities,
    };
  }

  private normalizeEmotion(emotion: LLMAnalysisResponse['emotion']): IEmotionAnalysis {
    const validEmotions: EmotionalState[] = [
      'neutral', 'happy', 'frustrated', 'confused', 'excited',
      'anxious', 'grateful', 'disappointed',
    ];

    const validUrgencies: UrgencyLevel[] = ['low', 'medium', 'high', 'critical'];

    return {
      primary: validEmotions.includes(emotion.primary as EmotionalState)
        ? (emotion.primary as EmotionalState)
        : 'neutral',
      intensity: Math.max(0, Math.min(1, emotion.intensity || 0.5)),
      urgency: validUrgencies.includes(emotion.urgency as UrgencyLevel)
        ? (emotion.urgency as UrgencyLevel)
        : 'medium',
    };
  }

  private fallbackAnalysis(input: string): IInputAnalysis {
    // Simple keyword-based fallback
    const lowerInput = input.toLowerCase();

    let intent: IntentCategory = 'unknown';
    if (/^(hi|hello|hey|你好|嗨)/.test(lowerInput)) {
      intent = 'greeting';
    } else if (/^(bye|goodbye|再见|拜拜)/.test(lowerInput)) {
      intent = 'farewell';
    } else if (/\?$|什么|怎么|为什么|how|what|why|where/.test(lowerInput)) {
      intent = 'question';
    } else if (/请|帮我|help|create|make|do|please/.test(lowerInput)) {
      intent = 'task_request';
    } else if (/status|progress|进度|状态/.test(lowerInput)) {
      intent = 'status_inquiry';
    } else if (/cancel|取消|停止|stop/.test(lowerInput)) {
      intent = 'cancellation';
    }

    return {
      intent: {
        primary: intent,
        confidence: 0.5,
        entities: [],
      },
      emotion: {
        primary: 'neutral',
        intensity: 0.5,
        urgency: 'medium',
      },
      purpose: {
        isActionable: intent === 'task_request',
        missingInfo: intent === 'task_request' ? ['detailed requirements'] : [],
      },
      rawInput: input,
      analyzedAt: Date.now(),
    };
  }
}
