import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IExecutionService, ExecutionResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { ReActIntegration } from '../../../autonomy/react-integration.js';
import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../../../infra/tools/tool-registry.js';
import { ReadFileTool } from '../../../infra/tools/implementations/read-file-tool.js';
import { WriteFileTool } from '../../../infra/tools/implementations/write-file-tool.js';
import { ExecuteCommandTool } from '../../../infra/tools/implementations/execute-command-tool.js';
import { SearchCodeTool } from '../../../infra/tools/implementations/search-code-tool.js';
import { WebSearchTool } from '../../../infra/tools/implementations/web-search-tool.js';
import { getGlobalSkillRegistry } from '../../../infra/skills/skill-registry.js';

export class ExecutionService implements IExecutionService {
  private reactIntegration: ReActIntegration;
  private toolRegistry: ToolRegistry;
  private toolAllowlist: ToolAllowlist;
  private toolEnforcer: ToolEnforcer;
  private skillRegistry = getGlobalSkillRegistry();

  constructor(
    private repository: IWorkOrderRepository,
    private config: {
      maxConsecutiveErrors: number;
    },
    llmProvider?: ILLMProvider
  ) {
    this.toolRegistry = new ToolRegistry();
    this.toolAllowlist = new ToolAllowlist();

    this.registerTools();

    this.toolEnforcer = new ToolEnforcer(this.toolRegistry, this.toolAllowlist);

    // Use enhanced ReAct integration with phase-aware prompts
    this.reactIntegration = new ReActIntegration(llmProvider, this.toolEnforcer);
  }

  /**
   * Initialize skills - should be called after workspace is known
   */
  async initializeSkills(workspaceDir: string): Promise<void> {
    await this.skillRegistry.loadSkills({
      workspaceDir,
      managedSkillsDir: `${process.env.HOME}/.ponybunny/skills`,
    });

    console.log(`[ExecutionService] Loaded ${this.skillRegistry.getSkills().length} skills`);
  }

  private registerTools(): void {
    this.toolRegistry.register(new ReadFileTool());
    this.toolRegistry.register(new WriteFileTool());
    this.toolRegistry.register(new ExecuteCommandTool());
    this.toolRegistry.register(new SearchCodeTool());
    this.toolRegistry.register(new WebSearchTool());

    // Allow tools by default (safe tools)
    this.toolAllowlist.addTool('search_code');
    this.toolAllowlist.addTool('read_file');
    this.toolAllowlist.addTool('write_file');
    this.toolAllowlist.addTool('execute_command');
    this.toolAllowlist.addTool('web_search');
  }

  async executeWorkItem(workItem: WorkItem): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Get goal for context
    const goal = this.repository.getGoal(workItem.goal_id);

    const runSequence = this.repository.getRunsByWorkItem(workItem.id).length + 1;
    const run = this.repository.createRun({
      work_item_id: workItem.id,
      goal_id: workItem.goal_id,
      agent_type: workItem.assigned_agent || 'default',
      run_sequence: runSequence,
    });

    try {
      // Enhanced: Pass goal context for phase-aware prompts
      const agentResult = await this.reactIntegration.executeWorkCycle({
        workItem,
        run,
        goal,
        signal: new AbortController().signal,
      });

      const timeSeconds = Math.floor((Date.now() - startTime) / 1000);

      this.repository.completeRun(run.id, {
        status: agentResult.success ? 'success' : 'failure',
        error_message: agentResult.error,
        tokens_used: agentResult.tokensUsed,
        time_seconds: timeSeconds,
        cost_usd: agentResult.costUsd,
        artifacts: agentResult.artifactIds || [],
        execution_log: agentResult.log,
      });

      this.repository.updateGoalSpending(
        workItem.goal_id,
        agentResult.tokensUsed,
        Math.ceil(timeSeconds / 60),
        agentResult.costUsd
      );

      const needsRetry = !agentResult.success && !this.shouldEscalateError(workItem);
      const errorSignature = this.generateErrorSignature(agentResult.error);

      return {
        run: this.repository.getRun(run.id)!,
        success: agentResult.success,
        needsRetry,
        errorSignature,
      };
    } catch (error) {
      const timeSeconds = Math.floor((Date.now() - startTime) / 1000);

      this.repository.completeRun(run.id, {
        status: 'failure',
        error_message: String(error),
        tokens_used: 0,
        time_seconds: timeSeconds,
        cost_usd: 0,
        artifacts: [],
      });

      return {
        run: this.repository.getRun(run.id)!,
        success: false,
        needsRetry: false,
        errorSignature: this.generateErrorSignature(String(error)),
      };
    }
  }

  private shouldEscalateError(workItem: WorkItem): boolean {
    if (workItem.retry_count >= workItem.max_retries) {
      return true;
    }

    const repeatedErrors = this.repository.getRepeatedErrorSignatures(
      workItem.id,
      this.config.maxConsecutiveErrors
    );

    return repeatedErrors.length > 0;
  }

  private generateErrorSignature(error?: string): string | undefined {
    if (!error) return undefined;

    const normalized = error
      .replace(/\d+/g, 'N')
      .replace(/0x[0-9a-f]+/gi, 'HEX')
      .replace(/\/[\w\/.-]+/g, 'PATH')
      .substring(0, 200);

    return this.simpleHash(normalized);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}
