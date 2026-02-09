/**
 * Enhanced ReAct Integration
 * Integrates with new System Prompt Builder
 */

import type { WorkItem, Run, Goal } from '../work-order/types/index.js';
import type { ILLMProvider, LLMMessage } from '../infra/llm/llm-provider.js';
import type { ToolEnforcer } from '../infra/tools/tool-registry.js';
import { getGlobalPromptProvider } from '../infra/prompts/prompt-provider.js';
import { getGlobalSkillRegistry } from '../infra/skills/skill-registry.js';

export interface ReActCycleParams {
  workItem: WorkItem;
  run: Run;
  signal: AbortSignal;
  model?: string;
  goal?: Goal;
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

  constructor(
    private llmProvider?: ILLMProvider,
    private toolEnforcer?: ToolEnforcer
  ) {}

  async executeWorkCycle(params: ReActCycleParams): Promise<ReActCycleResult> {
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
      await this.observation(context, this.buildInitialObservation(params.workItem));

      let maxIterations = 20;
      let completed = false;

      while (!completed && maxIterations > 0) {
        if (params.signal.aborted) {
          throw new Error('ReAct cycle aborted');
        }

        const thought = await this.think(context);
        await this.thought(context, thought);

        if (this.isTaskComplete(thought)) {
          completed = true;
          break;
        }

        if (this.isQuestionForUser(thought)) {
          break;
        }

        const action = await this.selectAction(context, thought);
        const actionResult = await this.executeAction(context, action);
        
        await this.observation(context, actionResult);
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

    if (context.conversationHistory.length === 0) {
      await this.observation(context, this.buildInitialObservation(params.workItem));
    }
    
    await this.observation(context, `User: ${userInput}`);

    let maxIterations = 5;
    let reply = '';

    while (maxIterations > 0) {
      if (params.signal.aborted) throw new Error('Aborted');

      const thought = await this.think(context);
      await this.thought(context, thought);

      if (this.isQuestionForUser(thought)) {
        reply = thought;
        break;
      }
      
      if (this.isTaskComplete(thought)) {
        reply = "Task completed.";
        break;
      }

      const action = await this.selectAction(context, thought);
      const actionResult = await this.executeAction(context, action);
      
      await this.observation(context, actionResult);
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
    return `Task: ${workItem.title}

Description: ${workItem.description}

Type: ${workItem.item_type}
Estimated Effort: ${workItem.estimated_effort}

${workItem.verification_plan ? `Verification Requirements:
${workItem.verification_plan.quality_gates.map(g => `- ${g.name}: ${g.command || g.review_prompt}`).join('\n')}
` : ''}

${workItem.context ? `Context:
${JSON.stringify(workItem.context, null, 2)}
` : ''}

Begin by analyzing the task and forming a plan.`;
  }

  private async think(context: ReActContext): Promise<string> {
    const prompt = this.buildThoughtPrompt(context);

    const response = await this.callLLM({
      system: context.systemPrompt,
      messages: this.buildMessageHistory(context),
      prompt,
      model: context.model,
      goalId: context.goal?.id,
      workItemId: context.workItem.id,
      runId: context.run.id,
    });

    context.totalTokens += response.tokensUsed;
    context.totalCost += response.cost;

    return response.text;
  }

  private async selectAction(context: ReActContext, thought: string): Promise<any> {
    const actionPrompt = `Based on your thought: "${thought}"

What action should be taken next? Respond with a JSON object:
{
  "tool": "tool_name",
  "parameters": { ... },
  "reasoning": "why this action"
}`;

    const response = await this.callLLM({
      system: context.systemPrompt,
      messages: [...this.buildMessageHistory(context), { role: 'user', content: actionPrompt }],
      model: context.model,
      goalId: context.goal?.id,
      workItemId: context.workItem.id,
      runId: context.run.id,
    });

    context.totalTokens += response.tokensUsed;
    context.totalCost += response.cost;

    try {
      return JSON.parse(response.text);
    } catch {
      return { tool: 'complete_task', parameters: {}, reasoning: 'Parse error' };
    }
  }

  private async executeAction(context: ReActContext, action: any): Promise<string> {
    if (action.tool === 'complete_task') {
      return 'Task marked as complete.';
    }

    if (!this.toolEnforcer) {
      return 'Error: No tool enforcer configured. Cannot execute tools.';
    }

    const check = this.toolEnforcer.checkToolInvocation(action.tool, action.parameters || {});
    
    if (!check.allowed) {
      return `Action denied: ${check.reason}`;
    }

    const tool = (this.toolEnforcer as any).registry.getTool(action.tool);
    if (!tool) {
      return `Error: Tool '${action.tool}' not found`;
    }

    try {
      const result = await tool.execute(action.parameters || {}, {
        cwd: process.cwd(),
        allowlist: (this.toolEnforcer as any).allowlist,
        enforcer: this.toolEnforcer,
      });
      return result;
    } catch (error) {
      return `Action failed: ${error}`;
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

  private buildThoughtPrompt(context: ReActContext): string {
    const lastObservation = context.conversationHistory
      .filter(s => s.type === 'observation')
      .pop();

    return `Observation: ${lastObservation?.content || 'No observation yet'}

What should you do next to complete this task? Think step by step.`;
  }

  private buildMessageHistory(context: ReActContext): Array<{ role: string; content: string }> {
    return context.conversationHistory.map(step => ({
      role: step.type === 'observation' ? 'system' : 'assistant',
      content: `[${step.type.toUpperCase()}] ${step.content}`,
    }));
  }

  private async callLLM(params: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    prompt?: string;
    model?: string;
    goalId?: string;
    workItemId?: string;
    runId?: string;
  }): Promise<{ text: string; tokensUsed: number; cost: number }> {
    if (!this.llmProvider) {
      return {
        text: 'Mock LLM response - no provider configured',
        tokensUsed: 500,
        cost: 0.005,
      };
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: params.system },
      ...params.messages.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
    ];

    if (params.prompt) {
      messages.push({ role: 'user', content: params.prompt });
    }

    try {
      const options = {
        ...(params.model ? { model: params.model } : {}),
        stream: true, // Enable streaming
        goalId: params.goalId,
        workItemId: params.workItemId,
        runId: params.runId,
      };
      const response = await this.llmProvider.complete(messages, options);
      const cost = this.llmProvider.estimateCost(response.tokensUsed);

      return {
        text: response.content,
        tokensUsed: response.tokensUsed,
        cost,
      };
    } catch (error) {
      throw new Error(`LLM call failed: ${(error as Error).message}`);
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
