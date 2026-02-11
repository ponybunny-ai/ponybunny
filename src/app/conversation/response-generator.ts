/**
 * Response Generator
 * Generates persona-aware responses using LLM with tool calling support
 */

import type { LLMService } from '../../infra/llm/llm-service.js';
import type { IPersona } from '../../domain/conversation/persona.js';
import type { IInputAnalysis } from '../../domain/conversation/analysis.js';
import type { IConversationTurn, IConversationContext } from '../../domain/conversation/session.js';
import type { ConversationState } from '../../domain/conversation/state-machine-rules.js';
import type { IPersonaEngine } from './persona-engine.js';
import type { LLMMessage, ToolCall } from '../../infra/llm/llm-provider.js';
import type { ToolEnforcer } from '../../infra/tools/tool-registry.js';
import { getGlobalToolProvider } from '../../infra/tools/tool-provider.js';
import { debug } from '../../debug/index.js';

export interface IResponseGenerator {
  generate(
    context: IResponseContext,
    onChunk?: (chunk: string) => void
  ): Promise<string>;

  generateProgressNarration(
    progress: ITaskProgress,
    persona: IPersona,
    onChunk?: (chunk: string) => void
  ): Promise<string>;

  generateResultSummary(
    result: ITaskResult,
    persona: IPersona,
    onChunk?: (chunk: string) => void
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
  private toolProvider = getGlobalToolProvider();

  constructor(
    private llmService: LLMService,
    private personaEngine: IPersonaEngine,
    private toolEnforcer?: ToolEnforcer
  ) {}

  async generate(context: IResponseContext, onChunk?: (chunk: string) => void): Promise<string> {
    debug.custom('response.generate.start', 'response-generator', {
      state: context.conversationState,
      personaId: context.persona.id,
      hasTaskInfo: !!context.taskInfo,
    });

    const systemPrompt = this.personaEngine.generateSystemPrompt(context.persona);
    const responsePrompt = this.buildResponsePrompt(context);

    const messages: LLMMessage[] = [
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

    // Get tool definitions (domain tools + MCP tools for conversation)
    const allTools = this.toolProvider.getToolDefinitions();
    const conversationTools = allTools.filter(tool =>
      ['web_search', 'find_skills'].includes(tool.name) || tool.name.startsWith('mcp__')
    );

    debug.custom('response.llm.request', 'response-generator', {
      agent: 'conversation',
      messageCount: messages.length,
      toolCount: conversationTools.length,
    });

    // Simple tool calling loop (max 3 iterations)
    let maxIterations = 3;
    let finalResponse = '';
    let accumulatedContent = '';

    while (maxIterations > 0) {
      const response = await this.llmService.completeForAgent(
        'conversation',
        messages,
        {
          maxTokens: 1000,
          tools: conversationTools,
          tool_choice: 'auto',
          thinking: true,
          stream: !!onChunk,
          onChunk: onChunk ? (chunk: string) => {
            accumulatedContent += chunk;
            onChunk(chunk);
          } : undefined,
        }
      );

      // Handle text response
      if (response.content) {
        finalResponse = response.content;
      } else if (accumulatedContent) {
        finalResponse = accumulatedContent;
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls,
        });

        // Execute tools (mock execution for now)
        for (const toolCall of response.toolCalls) {
          const result = await this.executeToolCall(toolCall);

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }
      } else {
        // No tool calls, we're done
        break;
      }

      maxIterations--;
    }

    debug.custom('response.llm.response', 'response-generator', {
      responseLength: finalResponse.length,
    });

    return finalResponse || 'I apologize, but I was unable to generate a response.';
  }

  private async executeToolCall(toolCall: ToolCall): Promise<string> {
    const toolName = toolCall.function.name;
    const parameters = JSON.parse(toolCall.function.arguments);

    // If we have a ToolEnforcer, use real tool execution
    if (this.toolEnforcer) {
      const check = this.toolEnforcer.checkToolInvocation(toolName, parameters);
      if (!check.allowed) {
        return `Tool '${toolName}' denied: ${check.reason}`;
      }

      const tool = this.toolEnforcer.registry.getTool(toolName);
      if (!tool) {
        return `Tool '${toolName}' not found in registry`;
      }

      try {
        return await tool.execute(parameters, {
          cwd: process.cwd(),
          allowlist: this.toolEnforcer.allowlist,
          enforcer: this.toolEnforcer,
        });
      } catch (error) {
        return `Tool '${toolName}' execution failed: ${(error as Error).message}`;
      }
    }

    // Fallback: no enforcer available
    return `Tool '${toolName}' executed (no registry configured)`;
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
    persona: IPersona,
    onChunk?: (chunk: string) => void
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
      {
        maxTokens: 200,
        stream: !!onChunk,
        onChunk: onChunk ? (chunk) => {
          if (chunk.content) {
            onChunk(chunk.content);
          }
        } : undefined,
      }
    );

    return response.content || 'Task is in progress.';
  }

  async generateResultSummary(
    result: ITaskResult,
    persona: IPersona,
    onChunk?: (chunk: string) => void
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
      {
        maxTokens: 500,
        stream: !!onChunk,
        onChunk: onChunk ? (chunk) => {
          if (chunk.content) {
            onChunk(chunk.content);
          }
        } : undefined,
      }
    );

    return response.content || (result.success ? 'Task completed successfully.' : 'Task failed.');
  }
}
