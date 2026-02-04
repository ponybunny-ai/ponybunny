import type { WorkItem, Run } from '../work-order/types/index.js';
import type { ILLMProvider, LLMMessage } from '../infra/llm/llm-provider.js';
import type { ToolEnforcer, ToolContext } from '../infra/tools/tool-registry.js';

export interface ReActCycleParams {
  workItem: WorkItem;
  run: Run;
  signal: AbortSignal;
  model?: string;
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
  conversationHistory: ReActStep[];
  totalTokens: number;
  totalCost: number;
  model?: string;
}

export class ReActIntegration {
  constructor(
    private llmProvider?: ILLMProvider,
    private toolEnforcer?: ToolEnforcer
  ) {}

  private availableSkills: any[] = [];

  setAvailableSkills(skills: any[]): void {
    this.availableSkills = skills;
  }

  async chatStep(params: ReActCycleParams, userInput: string): Promise<ReActCycleResult & { reply: string }> {
    console.log('[ReAct] chatStep called with input:', userInput);
    console.log('[ReAct] Using model:', params.model || 'default');
    
    const context: ReActContext = {
      workItem: params.workItem,
      run: params.run,
      conversationHistory: params.run.context?.history || [],
      totalTokens: 0,
      totalCost: 0,
      model: params.model,
    };

    if (context.conversationHistory.length === 0) {
      console.log('[ReAct] First message, adding initial observation with tools');
      await this.observation(context, this.buildInitialObservation(params.workItem));
    }
    
    await this.observation(context, `User: ${userInput}`);

    let maxIterations = 5;
    let reply = '';

    while (maxIterations > 0) {
        if (params.signal.aborted) throw new Error('Aborted');

        console.log('[ReAct] Iteration', 5 - maxIterations + 1, '- calling think()');
        const thought = await this.think(context);
        console.log('[ReAct] Thought:', thought);
        await this.thought(context, thought);

        if (this.isQuestionForUser(thought)) {
            console.log('[ReAct] Detected question for user, breaking loop');
            reply = thought;
            break;
        }
        
        if (this.isTaskComplete(thought)) {
            console.log('[ReAct] Task complete detected');
            reply = "Task completed.";
            break;
        }

        console.log('[ReAct] Selecting action...');
        const action = await this.selectAction(context, thought);
        console.log('[ReAct] Action:', action);
        
        const actionResult = await this.executeAction(context, action);
        console.log('[ReAct] Action result:', actionResult);
        
        await this.observation(context, actionResult);
        maxIterations--;
    }

    if (params.run.context) {
        params.run.context.history = context.conversationHistory;
    } else {
        params.run.context = { history: context.conversationHistory };
    }

    console.log('[ReAct] Returning reply:', reply || "I have completed the step.");
    
    return {
        success: true,
        tokensUsed: context.totalTokens,
        costUsd: context.totalCost,
        log: this.buildExecutionLog(context),
        reply: reply || "I have completed the step."
    };
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

  async executeWorkCycle(params: ReActCycleParams): Promise<ReActCycleResult> {
    const context: ReActContext = {
      workItem: params.workItem,
      run: params.run,
      conversationHistory: [],
      totalTokens: 0,
      totalCost: 0,
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

        // Check if the thought implies a question for the user
        if (this.isQuestionForUser(thought)) {
            // For now, we treat this as a "soft completion" or pause.
            // In a real interactive mode, we would yield here.
            // But executeWorkCycle is designed to be blocking.
            // We will need a new method `chatStep` for interactivity.
            break; 
        }

        const action = await this.selectAction(context, thought);
        const actionResult = await this.executeAction(context, action);
        
        await this.observation(context, actionResult);

        maxIterations--;
      }

      if (!completed) {
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

  private buildInitialObservation(workItem: WorkItem): string {
    let toolsList = '';

    if (this.toolEnforcer) {
      const registry = (this.toolEnforcer as any).registry;
      const allowlist = (this.toolEnforcer as any).allowlist;
      
      if (registry && allowlist) {
        const allTools = registry.getAllTools();
        const allowedTools = allTools.filter((t: any) => allowlist.isAllowed(t.name));
        
        toolsList = allowedTools.map((t: any) => `- ${t.name}: ${t.description}`).join('\n');
      }
    }

    if (!toolsList) {
      toolsList = `- read_file(path): Read file contents
- write_file(path, content): Write file
- execute_command(command): Run shell command
- search_code(pattern): Search codebase
- analyze_dependencies(work_item_id): Check dependency outputs`;
    }

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

Available Tools:
${toolsList}

${this.availableSkills.length > 0 ? `Available Skills (use 'read_file' to load SKILL.md for instructions):
${this.availableSkills.map(s => `- ${s.name}: ${s.description} (Path: ${s.path})`).join('\n')}` : ''}

Begin by analyzing the task and forming a plan.`;
  }

  private async think(context: ReActContext): Promise<string> {
    const prompt = this.buildThoughtPrompt(context);
    
    const response = await this.callLLM({
      system: this.getSystemPrompt(),
      messages: this.buildMessageHistory(context),
      prompt,
      model: context.model,
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
      system: this.getSystemPrompt(),
      messages: [...this.buildMessageHistory(context), { role: 'user', content: actionPrompt }],
      model: context.model,
    });

    context.totalTokens += response.tokensUsed;
    context.totalCost += response.cost;

    return JSON.parse(response.text);
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

    if (check.requiresApproval) {
      
    }

    const tool = (this.toolEnforcer as any).registry.getTool(action.tool);
    if (!tool) {
      return `Error: Tool '${action.tool}' found in enforcer but missing from registry (inconsistent state)`;
    }

    try {
      if (typeof tool.execute !== 'function') {
        return `Error: Tool '${action.tool}' does not have an execute method`;
      }

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

  private getSystemPrompt(): string {
    return `You are an autonomous AI agent working on software development tasks.

Your goal is to complete the assigned work item by:
1. Analyzing the requirements
2. Planning your approach
3. Executing the necessary actions
4. Verifying your work meets quality standards

You operate in a loop:
- OBSERVATION: You receive information about the task or results of actions
- THOUGHT: You reason about what to do next
- ACTION: You execute tools to make progress

When you believe the task is complete, explicitly state "task is complete" in your thought.

Be methodical, verify your work, and handle errors gracefully.`;
  }

  private async callLLM(params: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    prompt?: string;
    model?: string;
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
      const options = params.model ? { model: params.model } : undefined;
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



  private async collectArtifacts(context: ReActContext): Promise<string[]> {
    return [];
  }

  private buildExecutionLog(context: ReActContext): string {
    return context.conversationHistory
      .map(step => `[${new Date(step.timestamp).toISOString()}] ${step.type.toUpperCase()}: ${step.content}`)
      .join('\n\n');
  }
}
