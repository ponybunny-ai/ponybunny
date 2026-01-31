import type { WorkItem, Run } from '../work-order/types/index.js';

export interface ReActCycleParams {
  workItem: WorkItem;
  run: Run;
  signal: AbortSignal;
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
}

export class ReActIntegration {
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
- read_file(path): Read file contents
- write_file(path, content): Write file
- execute_command(command): Run shell command
- search_code(pattern): Search codebase
- analyze_dependencies(work_item_id): Check dependency outputs

Begin by analyzing the task and forming a plan.`;
  }

  private async think(context: ReActContext): Promise<string> {
    const prompt = this.buildThoughtPrompt(context);
    
    const response = await this.callLLM({
      system: this.getSystemPrompt(),
      messages: this.buildMessageHistory(context),
      prompt,
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
    });

    context.totalTokens += response.tokensUsed;
    context.totalCost += response.cost;

    return JSON.parse(response.text);
  }

  private async executeAction(context: ReActContext, action: any): Promise<string> {
    try {
      switch (action.tool) {
        case 'read_file':
          return await this.readFile(action.parameters.path);
        
        case 'write_file':
          return await this.writeFile(action.parameters.path, action.parameters.content);
        
        case 'execute_command':
          return await this.executeCommand(action.parameters.command);
        
        case 'search_code':
          return await this.searchCode(action.parameters.pattern);
        
        case 'complete_task':
          return 'Task marked as complete.';
        
        default:
          return `Unknown tool: ${action.tool}`;
      }
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
  }): Promise<{ text: string; tokensUsed: number; cost: number }> {
    return {
      text: 'Placeholder LLM response',
      tokensUsed: 500,
      cost: 0.005,
    };
  }

  private async readFile(path: string): Promise<string> {
    return `Contents of ${path}`;
  }

  private async writeFile(path: string, content: string): Promise<string> {
    return `Wrote ${content.length} bytes to ${path}`;
  }

  private async executeCommand(command: string): Promise<string> {
    return `Executed: ${command}\nExit code: 0`;
  }

  private async searchCode(pattern: string): Promise<string> {
    return `Search results for: ${pattern}`;
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
