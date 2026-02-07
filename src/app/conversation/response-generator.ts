/**
 * Response Generator
 * Generates persona-aware responses using LLM
 */

import type { LLMService } from '../../infra/llm/llm-service.js';
import type { IPersona } from '../../domain/conversation/persona.js';
import type { IInputAnalysis } from '../../domain/conversation/analysis.js';
import type { IConversationTurn, IConversationContext } from '../../domain/conversation/session.js';
import type { ConversationState } from '../../domain/conversation/state-machine-rules.js';
import type { IPersonaEngine } from './persona-engine.js';
import { debug } from '../../debug/index.js';

export interface IResponseGenerator {
  generate(
    context: IResponseContext
  ): Promise<string>;

  generateProgressNarration(
    progress: ITaskProgress,
    persona: IPersona
  ): Promise<string>;

  generateResultSummary(
    result: ITaskResult,
    persona: IPersona
  ): Promise<string>;
}

export interface IResponseContext {
  persona: IPersona;
  analysis: IInputAnalysis;
  conversationState: ConversationState;
  recentTurns: IConversationTurn[];
  taskInfo?: {
    goalId: string;
    status: string;
    progress?: number;
  };
}

export interface ITaskProgress {
  goalId: string;
  completedSteps: number;
  totalSteps: number;
  currentStep: string;
  elapsedTime: number;
}

export interface ITaskResult {
  goalId: string;
  success: boolean;
  summary: string;
  artifacts?: Array<{ type: string; description: string }>;
  errorMessage?: string;
}

export class ResponseGenerator implements IResponseGenerator {
  constructor(
    private llmService: LLMService,
    private personaEngine: IPersonaEngine
  ) {}

  async generate(context: IResponseContext): Promise<string> {
    debug.custom('response.generate.start', 'response-generator', {
      state: context.conversationState,
      personaId: context.persona.id,
      hasTaskInfo: !!context.taskInfo,
    });

    const systemPrompt = this.personaEngine.generateSystemPrompt(context.persona);
    const responsePrompt = this.buildResponsePrompt(context);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history
    for (const turn of context.recentTurns.slice(-10)) {
      messages.push({
        role: turn.role === 'user' ? 'user' : 'assistant',
        content: turn.content,
      });
    }

    // Add response generation instruction
    messages.push({
      role: 'user',
      content: responsePrompt,
    });

    debug.custom('response.llm.request', 'response-generator', {
      tier: 'simple',
      messageCount: messages.length,
    });

    const response = await this.llmService.completeWithTier(
      messages,
      'simple',
      { maxTokens: 1000 }
    );

    debug.custom('response.llm.response', 'response-generator', {
      responseLength: response.content.length,
    });

    return response.content;
  }

  private buildResponsePrompt(context: IResponseContext): string {
    const { analysis, conversationState, taskInfo } = context;
    const parts: string[] = [];

    parts.push(`User's message: "${analysis.rawInput}"`);
    parts.push(`Detected intent: ${analysis.intent.primary} (confidence: ${analysis.intent.confidence})`);
    parts.push(`User's emotion: ${analysis.emotion.primary} (urgency: ${analysis.emotion.urgency})`);
    parts.push(`Current conversation state: ${conversationState}`);

    if (taskInfo) {
      parts.push(`Active task: ${taskInfo.goalId} (status: ${taskInfo.status})`);
      if (taskInfo.progress !== undefined) {
        parts.push(`Task progress: ${Math.round(taskInfo.progress * 100)}%`);
      }
    }

    parts.push('');
    parts.push('Generate an appropriate response based on the above context.');
    parts.push('Match the persona\'s communication style and adapt to the user\'s emotional state.');

    if (conversationState === 'clarifying') {
      parts.push('Ask clarifying questions to gather missing information.');
      if (analysis.purpose.missingInfo.length > 0) {
        parts.push(`Missing information: ${analysis.purpose.missingInfo.join(', ')}`);
      }
    }

    if (conversationState === 'executing') {
      parts.push('Confirm that you will proceed with the task and briefly explain the approach.');
    }

    return parts.join('\n');
  }

  async generateProgressNarration(
    progress: ITaskProgress,
    persona: IPersona
  ): Promise<string> {
    const systemPrompt = this.personaEngine.generateSystemPrompt(persona);

    const progressPrompt = `Generate a brief progress update for the user.

Task ID: ${progress.goalId}
Progress: ${progress.completedSteps}/${progress.totalSteps} steps completed
Current step: ${progress.currentStep}
Elapsed time: ${Math.round(progress.elapsedTime / 1000)} seconds

Keep the update concise (1-2 sentences) and match the persona's style.`;

    const response = await this.llmService.completeWithTier(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: progressPrompt },
      ],
      'simple',
      { maxTokens: 200 }
    );

    return response.content;
  }

  async generateResultSummary(
    result: ITaskResult,
    persona: IPersona
  ): Promise<string> {
    const systemPrompt = this.personaEngine.generateSystemPrompt(persona);

    let resultPrompt = `Generate a result summary for the user.

Task ID: ${result.goalId}
Status: ${result.success ? 'SUCCESS' : 'FAILED'}
Summary: ${result.summary}`;

    if (result.artifacts && result.artifacts.length > 0) {
      resultPrompt += `\nArtifacts produced:\n${result.artifacts.map(a => `- ${a.type}: ${a.description}`).join('\n')}`;
    }

    if (result.errorMessage) {
      resultPrompt += `\nError: ${result.errorMessage}`;
    }

    resultPrompt += '\n\nProvide a natural summary that matches the persona\'s style.';
    if (!result.success) {
      resultPrompt += ' Offer helpful suggestions for next steps.';
    }

    const response = await this.llmService.completeWithTier(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: resultPrompt },
      ],
      'simple',
      { maxTokens: 500 }
    );

    return response.content;
  }
}
