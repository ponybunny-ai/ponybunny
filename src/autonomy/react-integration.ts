/**
 * Enhanced ReAct Integration
 * Integrates with new System Prompt Builder and native tool calling
 */

import type { WorkItem, Run, Goal } from '../work-order/types/index.js';
import type { ILLMProvider, LLMMessage, LLMResponse, ToolCall } from '../infra/llm/llm-provider.js';
import type { ToolEnforcer } from '../infra/tools/tool-registry.js';
import { getGlobalPromptProvider } from '../infra/prompts/prompt-provider.js';
import { ToolProvider, getGlobalToolProvider } from '../infra/tools/tool-provider.js';
import { routeContextFromWorkItemContext } from '../infra/routing/route-context.js';

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

type ExecutionIntentKind = 'simple_qa' | 'tool_task';

interface ExecutionIntent {
  kind: ExecutionIntentKind;
  rationale: string;
}

export class ReActIntegration {
  private promptProvider = getGlobalPromptProvider();
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

      const allTools = activeToolProvider.getToolDefinitions('execution');
      const intent = await this.classifyIntent(params.workItem, params.model);
      await this.observation(
        context,
        `Intent classified: ${intent.kind} (${intent.rationale || 'no rationale'})`
      );

      if (intent.kind === 'simple_qa') {
        const directAnswer = await this.synthesizeSimpleAnswer(params.workItem, params.model);
        context.totalTokens += directAnswer.tokensUsed;
        context.totalCost += this.llmProvider?.estimateCost(directAnswer.tokensUsed) || 0;

        const content = typeof directAnswer.content === 'string' ? directAnswer.content.trim() : '';
        if (content.length > 0) {
          await this.thought(context, content);
          return {
            success: true,
            tokensUsed: context.totalTokens,
            costUsd: context.totalCost,
            artifactIds: await this.collectArtifacts(context),
            log: this.buildExecutionLog(context),
          };
        }
      }

      await this.observation(
        context,
        `Tool strategy: llm_native_first -> local_fallback (tools available: ${allTools.length})`
      );

      let maxIterations = 20;
      const maxNoActionIterations = 3;
      const maxEmptyResponseRetries = 1;
      let completed = false;
      let noActionIterations = 0;
      let emptyResponseRetries = 0;
      let requireToolCallNext = false;
      let incompleteExitReason: string | undefined;
      let emittedRuntimeEnvelope = false;

      while (!completed && maxIterations > 0) {
        if (params.signal.aborted) {
          throw new Error('ReAct cycle aborted');
        }

        // Get tool definitions for this phase
        const tools = activeToolProvider.getToolDefinitions('execution');

        if (!emittedRuntimeEnvelope) {
          await this.observation(context, this.buildRuntimeEnvelopeAudit(params.workItem, tools));
          emittedRuntimeEnvelope = true;
        }

        // Call LLM with tools
        const response = await this.callLLMWithTools(messages, tools, params.model, requireToolCallNext);

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
          noActionIterations = 0;
          emptyResponseRetries = 0;
          requireToolCallNext = false;

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.toolCalls,
          });

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
            if (toolCall.function.name === 'complete_task') {
              const summary = this.extractCompleteTaskSummary(toolCall.function.arguments);
              if (summary) {
                await this.thought(context, `Completion summary: ${summary}`);
              }
              await this.observation(context, 'Tool complete_task: Task marked as complete.');
              completed = true;
              break;
            }

            const result = await this.executeToolCall(context, toolCall, activeToolEnforcer);

            // Add tool result to messages
            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });

            await this.observation(context, `Tool ${toolCall.function.name}: ${result}`);
          }

          if (completed) {
            break;
          }
        } else {
          // No tool calls, add assistant message
          messages.push({
            role: 'assistant',
            content: response.content,
          });

          if (!completed) {
            const hasVisibleContent = typeof response.content === 'string' && response.content.trim().length > 0;

            if (!hasVisibleContent) {
              if (emptyResponseRetries >= maxEmptyResponseRetries) {
                const fallbackResult = await this.executeLocalFallback(
                  context,
                  params.workItem,
                  tools,
                  activeToolEnforcer,
                  messages
                );
                if (fallbackResult) {
                  context.totalTokens += fallbackResult.tokensUsed;
                  context.totalCost += this.llmProvider?.estimateCost(fallbackResult.tokensUsed) || 0;

                  const synthesis = typeof fallbackResult.content === 'string' ? fallbackResult.content.trim() : '';
                  if (synthesis.length > 0) {
                    await this.thought(context, synthesis);
                    completed = true;
                    break;
                  }
                }

                incompleteExitReason = 'Execution stopped: repeated empty model responses without tool calls';
                break;
              }

              emptyResponseRetries++;
              requireToolCallNext = true;
              messages.push({
                role: 'user',
                content: this.buildImmediateActionDirective(tools, true),
              });
              await this.observation(context, 'Empty model response without tool call; forced explicit next action prompt.');
              maxIterations--;
              continue;
            }

            noActionIterations++;
            emptyResponseRetries = 0;
            requireToolCallNext = true;

            if (noActionIterations >= maxNoActionIterations) {
              incompleteExitReason = `Execution stopped: no actionable tool calls after ${maxNoActionIterations} attempts`;
              break;
            }

            messages.push({
              role: 'user',
              content: this.buildImmediateActionDirective(tools, false),
            });
            await this.observation(context, 'No actionable tool call emitted; requested next concrete action.');
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
    const routeContext = routeContextFromWorkItemContext(workItem.context);

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

    const routeContextHint = routeContext
      ? `Route Context:
- source: ${routeContext.source}
- provider: ${routeContext.providerId || 'unspecified'}
- channel: ${routeContext.channel || 'unspecified'}
- agent: ${routeContext.agentId || 'unspecified'}
- owner: ${routeContext.senderIsOwner === true ? 'true' : 'false'}
`
      : '';

    // Add skill suggestions if available (from pre-search)
    const skillSuggestions = this.buildSkillSuggestions(workItem);
    
    return `${baseObservation}

${routeContextHint}

${skillSuggestions}

Execution contract:
- Your tools run on the local machine and current workspace.
- Prefer existing local tools first (MCP, skills, built-in tools).
- If needed capability is missing, use find_skills or web_search to locate an existing solution.
- If still unavailable, implement an ad-hoc local solution with available tools.

Respond with at most 2 short planning lines, then immediately issue the first concrete tool call.`;
  }

  private buildRuntimeEnvelopeAudit(
    workItem: WorkItem,
    tools: import('../infra/llm/llm-provider.js').ToolDefinition[]
  ): string {
    const routeContext = routeContextFromWorkItemContext(workItem.context);
    const toolNames = tools.map((tool) => tool.name).join(', ');

    if (!routeContext) {
      return `Runtime envelope selected: tools=[${toolNames}] routeContext=none`;
    }

    return `Runtime envelope selected: tools=[${toolNames}] routeContext={source:${routeContext.source},provider:${routeContext.providerId || 'unspecified'},channel:${routeContext.channel || 'unspecified'},agent:${routeContext.agentId || 'unspecified'},owner:${routeContext.senderIsOwner === true ? 'true' : 'false'}}`;
  }

  private buildImmediateActionDirective(
    tools: import('../infra/llm/llm-provider.js').ToolDefinition[],
    fromEmptyResponse: boolean
  ): string {
    const previewCount = 12;
    const toolNames = tools.slice(0, previewCount).map((tool) => tool.name);
    const remaining = tools.length - toolNames.length;
    const toolLabel = remaining > 0 ? `${toolNames.join(', ')} (+${remaining} more)` : toolNames.join(', ');
    const firstLine = fromEmptyResponse
      ? 'Your previous response was empty.'
      : 'Do not provide another planning update.';

    return `${firstLine} Call exactly one concrete tool now using only available tools. Preferred candidates: ${toolLabel}. If and only if the task is fully complete, call complete_task with a concise summary.`;
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

  private async classifyIntent(workItem: WorkItem, model?: string): Promise<ExecutionIntent> {
    if (!this.llmProvider) {
      return {
        kind: 'tool_task',
        rationale: 'No LLM provider configured; defaulting to tool task',
      };
    }

    const classifierPrompt = [
      'Classify the task intent and output strict JSON only.',
      'Schema: {"kind":"simple_qa"|"tool_task","rationale":"short reason"}',
      'Use simple_qa only when no external tools are needed.',
      `Task title: ${workItem.title}`,
      `Task description: ${workItem.description}`,
    ].join('\n');

    try {
      const response = await this.llmProvider.complete(
        [{ role: 'user', content: classifierPrompt }],
        {
          model,
          tool_choice: 'none',
          thinking: false,
          temperature: 0,
        }
      );

      const raw = typeof response.content === 'string' ? response.content : '';
      const parsed = this.parseFirstJsonObject(raw) as { kind?: unknown; rationale?: unknown } | null;
      if (parsed && (parsed.kind === 'simple_qa' || parsed.kind === 'tool_task')) {
        return {
          kind: parsed.kind,
          rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'classified by intent pass',
        };
      }
    } catch {
      // Fall through to heuristic classification
    }

    const lowered = `${workItem.title} ${workItem.description}`.toLowerCase().trim();
    const likelyToolTask =
      workItem.item_type !== 'analysis' ||
      ['search', 'find', 'lookup', 'company', 'query', 'database', 'api', 'fetch', 'get ', 'execute', 'implement'].some(
        (token) => lowered.includes(token)
      );

    return {
      kind: likelyToolTask ? 'tool_task' : 'simple_qa',
      rationale: 'heuristic fallback classification',
    };
  }

  private async synthesizeSimpleAnswer(workItem: WorkItem, model?: string): Promise<LLMResponse> {
    if (!this.llmProvider) {
      return {
        content: '',
        tokensUsed: 0,
        model: model || 'unknown',
        finishReason: 'error',
      };
    }

    const prompt = [
      'Answer the task directly and concisely without using tools.',
      `Task title: ${workItem.title}`,
      `Task description: ${workItem.description}`,
    ].join('\n');

    return this.llmProvider.complete([{ role: 'user', content: prompt }], {
      model,
      tool_choice: 'none',
      thinking: false,
    });
  }

  private async executeLocalFallback(
    context: ReActContext,
    workItem: WorkItem,
    tools: import('../infra/llm/llm-provider.js').ToolDefinition[],
    toolEnforcer: ToolEnforcer | undefined,
    messages: LLMMessage[]
  ): Promise<LLMResponse | null> {
    if (!toolEnforcer || !this.llmProvider) {
      return null;
    }

    const fallbackToolCalls: ToolCall[] = [];
    const query = this.extractCompanyQuery(workItem.description) || workItem.description;

    const searchTools = tools.filter((tool) => this.isFallbackSearchTool(tool));
    for (const tool of searchTools) {
      for (const args of this.buildSearchArgsFromSchema(query, tool)) {
        fallbackToolCalls.push(this.createSyntheticToolCall(tool.name, args));
      }
    }

    let successfulResult: string | null = null;

    for (const toolCall of fallbackToolCalls) {
      const result = await this.executeToolCall(context, toolCall, toolEnforcer);
      await this.observation(context, `Fallback tool ${toolCall.function.name}: ${result}`);

      if (this.isSuccessfulToolResult(result)) {
        successfulResult = result;
        messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
        messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id });

        break;
      }
    }

    if (!successfulResult) {
      return null;
    }

    return this.llmProvider.complete(
      [
        ...messages,
        {
          role: 'user',
          content:
            'Use the tool output above to answer the original task fully. If information is missing, say what is missing explicitly.',
        },
      ],
      {
        model: context.model,
        tool_choice: 'none',
      }
    );
  }

  private createSyntheticToolCall(name: string, args: Record<string, unknown>): ToolCall {
    return {
      id: `fallback_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    };
  }

  private isSuccessfulToolResult(result: string): boolean {
    if (!result || result.trim().length === 0) {
      return false;
    }

    const lowered = result.toLowerCase();
    if (
      lowered.startsWith('error:') ||
      lowered.startsWith('action denied:') ||
      lowered.startsWith('tool execution failed:')
    ) {
      return false;
    }

    const parsed = this.parseFirstJsonObject(result);
    if (parsed) {
      const statusCode = parsed.statusCode;
      if (typeof statusCode === 'number' && statusCode >= 400) {
        return false;
      }

      const error = parsed.error;
      const code = parsed.code;
      if (typeof error === 'string' && error.trim().length > 0) {
        return false;
      }
      if (typeof code === 'string' && code.trim().length > 0 && code !== '0') {
        return false;
      }
    }

    return true;
  }

  private buildSearchArgsFromSchema(
    query: string,
    toolDef: import('../infra/llm/llm-provider.js').ToolDefinition
  ): Array<Record<string, unknown>> {
    const required = toolDef.parameters.required ?? [];
    const properties = toolDef.parameters.properties ?? {};
    const candidates: Array<Record<string, unknown>> = [];
    const knownQueryKeys = ['q', 'query', 'company_name', 'name', 'search', 'term', 'keyword'];

    const requiredQueryKeys = required.filter((key) => knownQueryKeys.includes(key));
    const propertyQueryKeys = Object.keys(properties).filter((key) => knownQueryKeys.includes(key));

    const prioritizedKeys = [...new Set([...requiredQueryKeys, ...propertyQueryKeys, ...knownQueryKeys])];

    for (const key of prioritizedKeys) {
      if (required.length > 0 && !required.every((requiredKey) => requiredKey === key || !knownQueryKeys.includes(requiredKey))) {
        continue;
      }

      const args: Record<string, unknown> = { [key]: query };
      const unresolvedRequired = required.filter((requiredKey) => !(requiredKey in args));
      if (unresolvedRequired.length === 0 || unresolvedRequired.every((requiredKey) => !knownQueryKeys.includes(requiredKey))) {
        candidates.push(args);
      }
    }

    if (candidates.length === 0 && required.length === 1) {
      candidates.push({ [required[0]]: query });
    }

    if (candidates.length === 0) {
      candidates.push({ query });
    }

    const seen = new Set<string>();
    const deduped: Array<Record<string, unknown>> = [];
    for (const item of candidates) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }

    return deduped;
  }

  private isFallbackSearchTool(tool: import('../infra/llm/llm-provider.js').ToolDefinition): boolean {
    if (tool.name === 'complete_task') {
      return false;
    }

    const lowered = tool.name.toLowerCase();
    if (lowered.includes('search') || lowered.includes('query') || lowered.includes('lookup')) {
      return true;
    }

    const keys = Object.keys(tool.parameters.properties ?? {});
    return keys.some((key) => ['q', 'query', 'name', 'company_name', 'keyword', 'term'].includes(key));
  }

  private extractCompanyQuery(description: string): string | null {
    const match = description.match(/company information of\s+(.+)$/i);
    if (!match) {
      return null;
    }
    return match[1].trim();
  }

  private parseFirstJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, end + 1));
          return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
      return null;
    }
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

  private extractCompleteTaskSummary(argumentsJson: string): string | null {
    try {
      const parsed = JSON.parse(argumentsJson) as { summary?: unknown };
      if (typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
        return parsed.summary.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  private async callLLMWithTools(
    messages: LLMMessage[],
    tools: import('../infra/llm/llm-provider.js').ToolDefinition[],
    model?: string,
    requireToolCall: boolean = false
  ): Promise<LLMResponse> {
    if (!this.llmProvider) {
      throw new Error('No LLM provider configured');
    }

    const options: any = {
      tools,
      tool_choice: requireToolCall && tools.length > 0 ? 'required' : 'auto',
      thinking: true, // Enable thinking mode if supported
    };

    if (model) {
      options.model = model;
    }

    return await this.llmProvider.complete(messages, options);
  }

  private async executeToolCall(
    _context: ReActContext,
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
