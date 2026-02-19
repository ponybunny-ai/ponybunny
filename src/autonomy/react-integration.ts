/**
 * Enhanced ReAct Integration
 * Integrates with new System Prompt Builder and native tool calling
 */

import type { WorkItem, Run, Goal } from '../work-order/types/index.js';
import type { ILLMProvider, LLMMessage, LLMResponse, ToolCall } from '../infra/llm/llm-provider.js';
import type { ToolEnforcer } from '../infra/tools/tool-registry.js';
import { getGlobalPromptProvider } from '../infra/prompts/prompt-provider.js';
import { getGlobalSkillRegistry } from '../infra/skills/skill-registry.js';
import { ToolProvider, getGlobalToolProvider } from '../infra/tools/tool-provider.js';

export interface ReActCycleParams {
  workItem: WorkItem;
  run: Run;
  signal: AbortSignal;
  model?: string;
  goal?: Goal;
  toolEnforcer?: ToolEnforcer;
}

export interface ReActCycleResult {
  success: boolean;
  error?: string;
  tokensUsed: number;
  costUsd: number;
  artifactIds?: string[];
  log?: string;
}

export interface ReActStep {
  type: 'observation' | 'thought' | 'action';
  content: string;
  timestamp: number;
}

export interface ReActContext {
  workItem: WorkItem;
  run: Run;
  goal?: Goal;
  conversationHistory: ReActStep[];
  totalTokens: number;
  totalCost: number;
  model?: string;
  systemPrompt: string;
}

export class ReActIntegration {
  private promptProvider = getGlobalPromptProvider();
  private skillRegistry = getGlobalSkillRegistry();
  private toolProvider = getGlobalToolProvider();

  constructor(
    private llmProvider?: ILLMProvider,
    private toolEnforcer?: ToolEnforcer
  ) {}

  async executeWorkCycle(params: ReActCycleParams): Promise<ReActCycleResult> {
    const activeToolEnforcer = params.toolEnforcer ?? this.toolEnforcer;
    const activeToolProvider = activeToolEnforcer
      ? new ToolProvider(activeToolEnforcer)
      : this.toolProvider;

    // Generate phase-aware system prompt
    const systemPrompt = this.promptProvider.generateExecutionPrompt({
      workspaceDir: process.cwd(),
      goal: params.goal,
      workItem: params.workItem,
      budgetTokens: params.goal?.budget_tokens,
      spentTokens: params.goal?.spent_tokens,
      modelName: params.model,
    });

    const context: ReActContext = {
      workItem: params.workItem,
      run: params.run,
      goal: params.goal,
      conversationHistory: [],
      totalTokens: 0,
      totalCost: 0,
      model: params.model,
      systemPrompt,
    };

    try {
      // Build conversation with native tool calling
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this.buildInitialObservation(params.workItem) },
      ];

      let maxIterations = 20;
      let completed = false;
      let incompleteExitReason: string | undefined;

      while (!completed && maxIterations > 0) {
        if (params.signal.aborted) {
          throw new Error('ReAct cycle aborted');
        }

        // Get tool definitions for this phase
        const tools = activeToolProvider.getToolDefinitions('execution');

        // Call LLM with tools
        const response = await this.callLLMWithTools(messages, tools, params.model);

        context.totalTokens += response.tokensUsed;
        context.totalCost += this.llmProvider?.estimateCost(response.tokensUsed) || 0;

        // Record thinking if present
        if (response.thinking) {
          await this.thought(context, response.thinking);
        }

        // Handle text response
        if (response.content) {
          await this.thought(context, response.content);

          if (this.isTaskComplete(response.content)) {
            completed = true;
            break;
          }

          if (this.isQuestionForUser(response.content)) {
            incompleteExitReason = 'Execution paused: model requested user input before completion';
            break;
          }
        }

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.toolCalls,
          });

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
              const result = await this.executeToolCall(context, toolCall, activeToolEnforcer);

            // Add tool result to messages
            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });

            await this.observation(context, `Tool ${toolCall.function.name}: ${result}`);
          }
        } else {
          // No tool calls, add assistant message
          messages.push({
            role: 'assistant',
            content: response.content,
          });

          // If no tool calls and not complete, we're done
          if (!completed) {
            incompleteExitReason = 'Execution stopped: no tool calls and completion not detected';
            break;
          }
        }

        maxIterations--;
      }

      if (!completed && maxIterations === 0) {
        return {
          success: false,
          error: 'Max iterations reached without completion',
          tokensUsed: context.totalTokens,
          costUsd: context.totalCost,
          log: this.buildExecutionLog(context),
        };
      }

      if (!completed) {
        return {
          success: false,
          error: incompleteExitReason || 'Execution ended before completion',
          tokensUsed: context.totalTokens,
          costUsd: context.totalCost,
          log: this.buildExecutionLog(context),
        };
      }

      return {
        success: true,
        tokensUsed: context.totalTokens,
        costUsd: context.totalCost,
        artifactIds: await this.collectArtifacts(context),
        log: this.buildExecutionLog(context),
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
        tokensUsed: context.totalTokens,
        costUsd: context.totalCost,
        log: this.buildExecutionLog(context),
      };
    }
  }

  async chatStep(params: ReActCycleParams, userInput: string): Promise<ReActCycleResult & { reply: string }> {
    const activeToolEnforcer = params.toolEnforcer ?? this.toolEnforcer;
    const activeToolProvider = activeToolEnforcer
      ? new ToolProvider(activeToolEnforcer)
      : this.toolProvider;

    const systemPrompt = this.promptProvider.generateExecutionPrompt({
      workspaceDir: process.cwd(),
      goal: params.goal,
      workItem: params.workItem,
      budgetTokens: params.goal?.budget_tokens,
      spentTokens: params.goal?.spent_tokens,
      modelName: params.model,
    });

    const context: ReActContext = {
      workItem: params.workItem,
      run: params.run,
      goal: params.goal,
      conversationHistory: params.run.context?.history || [],
      totalTokens: 0,
      totalCost: 0,
      model: params.model,
      systemPrompt,
    };

    // Build messages from history
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    if (context.conversationHistory.length === 0) {
      messages.push({ role: 'user', content: this.buildInitialObservation(params.workItem) });
    }

    // Add user input
    messages.push({ role: 'user', content: userInput });
    await this.observation(context, `User: ${userInput}`);

    let maxIterations = 5;
    let reply = '';

    // Get tool definitions
    const tools = activeToolProvider.getToolDefinitions('execution');

    while (maxIterations > 0) {
      if (params.signal.aborted) throw new Error('Aborted');

      // Call LLM with tools
      const response = await this.callLLMWithTools(messages, tools, params.model);

      context.totalTokens += response.tokensUsed;
      context.totalCost += this.llmProvider?.estimateCost(response.tokensUsed) || 0;

      // Record thinking
      if (response.thinking) {
        await this.thought(context, response.thinking);
      }

      // Handle text response
      if (response.content) {
        await this.thought(context, response.content);
        reply = response.content;

        if (this.isTaskComplete(response.content)) {
          break;
        }

        if (this.isQuestionForUser(response.content)) {
          break;
        }
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls,
        });

        // Execute each tool call
        for (const toolCall of response.toolCalls) {
          const result = await this.executeToolCall(context, toolCall, activeToolEnforcer);

          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });

          await this.observation(context, `Tool ${toolCall.function.name}: ${result}`);
        }
      } else {
        // No tool calls, add assistant message and break
        messages.push({
          role: 'assistant',
          content: response.content,
        });
        break;
      }

      maxIterations--;
    }

    if (params.run.context) {
      params.run.context.history = context.conversationHistory;
    } else {
      params.run.context = { history: context.conversationHistory };
    }

    return {
      success: true,
      tokensUsed: context.totalTokens,
      costUsd: context.totalCost,
      log: this.buildExecutionLog(context),
      reply: reply || "I have completed the step."
    };
  }

  private buildInitialObservation(workItem: WorkItem): string {
    const baseObservation = `Task: ${workItem.title}

Description: ${workItem.description}

Type: ${workItem.item_type}
Estimated Effort: ${workItem.estimated_effort}

${workItem.verification_plan ? `Verification Requirements:
${workItem.verification_plan.quality_gates.map(g => `- ${g.name}: ${g.command || g.review_prompt}`).join('\n')}
` : ''}

${workItem.context ? `Context:
${JSON.stringify(workItem.context, null, 2)}
` : ''}`;

    // Add skill suggestions if available (from pre-search)
    const skillSuggestions = this.buildSkillSuggestions(workItem);
    
    return `${baseObservation}

${skillSuggestions}

Begin by analyzing the task and forming a plan.`;
  }

  private buildSkillSuggestions(workItem: WorkItem): string {
    const suggestions: string[] = [];
    
    // Check if pre-searched skills are available
    if (workItem.context?.suggestedSkills && Array.isArray(workItem.context.suggestedSkills)) {
      const skills = workItem.context.suggestedSkills;
      if (skills.length > 0) {
        suggestions.push('**Suggested Skills** (pre-searched from skills.sh):');
        for (const skill of skills) {
          suggestions.push(`- ${skill.name}: ${skill.description}`);
          suggestions.push(`  Install: find_skills({"query": "${skill.name}", "install": true})`);
        }
        suggestions.push('');
      }
    }
    
    // Extract keywords for skill search
    const keywords = this.extractKeywords(workItem.description);
    if (keywords.length > 0 && process.env.PONY_SKILL_SUGGESTIONS !== 'false') {
      suggestions.push('**Skill Search Suggestions**:');
      suggestions.push(`Consider searching for skills related to: ${keywords.join(', ')}`);
      suggestions.push(`Example: find_skills({"query": "${keywords[0]}", "install": true})`);
    }
    
    return suggestions.join('\n');
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - can be enhanced with NLP
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how']);
    
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));
    
    // Get unique words and limit to top 5
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 5);
  }


  private async observation(context: ReActContext, content: string): Promise<void> {
    context.conversationHistory.push({
      type: 'observation',
      content,
      timestamp: Date.now(),
    });
  }

  private async thought(context: ReActContext, content: string): Promise<void> {
    context.conversationHistory.push({
      type: 'thought',
      content,
      timestamp: Date.now(),
    });
  }

  private isTaskComplete(thought: string): boolean {
    const completionIndicators = [
      'task is complete',
      'successfully completed',
      'verification passed',
      'all requirements met',
      'ready to submit',
    ];

    const lowerThought = thought.toLowerCase();
    return completionIndicators.some(indicator => lowerThought.includes(indicator));
  }

  private isQuestionForUser(thought: string): boolean {
    const lowerThought = thought.toLowerCase();
    return lowerThought.includes('ask the user') || 
           lowerThought.includes('need user input') ||
           lowerThought.includes('user should') ||
           (lowerThought.includes('?') && (
             lowerThought.includes('user') || 
             lowerThought.includes('you want') ||
             lowerThought.includes('would you') ||
             lowerThought.includes('should i')
           ));
  }

  private async callLLMWithTools(
    messages: LLMMessage[],
    tools: import('../infra/llm/llm-provider.js').ToolDefinition[],
    model?: string
  ): Promise<LLMResponse> {
    if (!this.llmProvider) {
      throw new Error('No LLM provider configured');
    }

    const options: any = {
      tools,
      tool_choice: 'auto',
      thinking: true, // Enable thinking mode if supported
    };

    if (model) {
      options.model = model;
    }

    return await this.llmProvider.complete(messages, options);
  }

  private async executeToolCall(
    context: ReActContext,
    toolCall: ToolCall,
    toolEnforcer?: ToolEnforcer
  ): Promise<string> {
    const toolName = toolCall.function.name;
    const parameters = JSON.parse(toolCall.function.arguments);

    // Special handling for complete_task
    if (toolName === 'complete_task') {
      return 'Task marked as complete.';
    }

    if (!toolEnforcer) {
      return 'Error: No tool enforcer configured. Cannot execute tools.';
    }

    const check = toolEnforcer.checkToolInvocation(toolName, parameters);

    if (!check.allowed) {
      return `Action denied: ${check.reason}`;
    }

    const tool = toolEnforcer.registry.getTool(toolName);
    if (!tool) {
      return `Error: Tool '${toolName}' not found`;
    }

    try {
      const result = await tool.execute(parameters, {
        cwd: process.cwd(),
        allowlist: toolEnforcer.allowlist,
        enforcer: toolEnforcer,
      });
      return result;
    } catch (error) {
      return `Tool execution failed: ${error}`;
    }
  }

  private async collectArtifacts(_context: ReActContext): Promise<string[]> {
    return [];
  }

  private buildExecutionLog(context: ReActContext): string {
    return context.conversationHistory
      .map(step => `[${step.type.toUpperCase()}] ${step.content}`)
      .join('\n\n');
  }
}
