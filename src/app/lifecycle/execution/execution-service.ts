import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IExecutionService, ExecutionResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { ReActIntegration } from '../../../autonomy/react-integration.js';
import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../../../infra/tools/tool-registry.js';
import { ToolProvider, setGlobalToolProvider } from '../../../infra/tools/tool-provider.js';
import { ReadFileTool } from '../../../infra/tools/implementations/read-file-tool.js';
import { WriteFileTool } from '../../../infra/tools/implementations/write-file-tool.js';
import { ExecuteCommandTool } from '../../../infra/tools/implementations/execute-command-tool.js';
import { SearchCodeTool } from '../../../infra/tools/implementations/search-code-tool.js';
import { WebSearchTool } from '../../../infra/tools/implementations/web-search-tool.js';
import { findSkillsTool } from '../../../infra/tools/implementations/find-skills-tool.js';
import { getGlobalSkillRegistry } from '../../../infra/skills/skill-registry.js';
import { initializeMCPIntegration } from '../../../infra/mcp/adapters/registry-integration.js';

export class ExecutionService implements IExecutionService {
  private reactIntegration: ReActIntegration;
  private toolRegistry: ToolRegistry;
  private toolAllowlist: ToolAllowlist;
  private toolEnforcer: ToolEnforcer;
  private skillRegistry = getGlobalSkillRegistry();
  private mcpInitialized = false;

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

    // Wire up ToolProvider with ToolRegistry so LLM sees all registered tools
    const toolProvider = new ToolProvider(this.toolEnforcer);
    setGlobalToolProvider(toolProvider);

    // Use enhanced ReAct integration with phase-aware prompts
    this.reactIntegration = new ReActIntegration(llmProvider, this.toolEnforcer);
  }

  /**
   * Initialize skills - should be called after workspace is known
   */
  async initializeSkills(workspaceDir: string): Promise<void> {
    const managedSkillsDir = process.env.PONYBUNNY_SKILLS_DIR || `${process.env.HOME}/.ponybunny/skills`;
    await this.skillRegistry.loadSkills({
      workspaceDir,
      managedSkillsDir,
    });

    console.log(`[ExecutionService] Loaded ${this.skillRegistry.getSkills().length} skills`);
  }

  /**
   * Initialize MCP integration - connects to MCP servers and registers their tools
   * Should be called once during service startup
   */
  async initializeMCP(): Promise<void> {
    if (this.mcpInitialized) return;

    try {
      await initializeMCPIntegration(this.toolRegistry);

      // Auto-allow all newly registered MCP tools
      const mcpTools = this.toolRegistry.getAllTools().filter(t => t.name.startsWith('mcp__'));
      for (const tool of mcpTools) {
        this.toolAllowlist.addTool(tool.name);
      }

      this.mcpInitialized = true;
      console.log(`[ExecutionService] MCP initialized with ${mcpTools.length} tools`);
    } catch (error) {
      console.warn(`[ExecutionService] MCP initialization failed (non-fatal): ${error}`);
    }
  }

  private registerTools(): void {
    this.toolRegistry.register(new ReadFileTool());
    this.toolRegistry.register(new WriteFileTool());
    this.toolRegistry.register(new ExecuteCommandTool());
    this.toolRegistry.register(new SearchCodeTool());
    this.toolRegistry.register(new WebSearchTool());
    this.toolRegistry.register(findSkillsTool);

    // Allow tools by default (safe tools)
    this.toolAllowlist.addTool('read_file');
    this.toolAllowlist.addTool('write_file');
    this.toolAllowlist.addTool('execute_command');
    this.toolAllowlist.addTool('search_code');
    this.toolAllowlist.addTool('web_search');
    this.toolAllowlist.addTool('find_skills');
  }

  async executeWorkItem(workItem: WorkItem): Promise<ExecutionResult> {
    const startTime = Date.now();
    const scopedToolEnforcer = this.createScopedToolEnforcer(workItem);

    const goal = this.repository.getGoal(workItem.goal_id);

    if (process.env.PONY_SKILL_AUTO_DISCOVERY !== 'false') {
      await this.preSearchSkills(workItem);
    }

    const runSequence = this.repository.getRunsByWorkItem(workItem.id).length + 1;
    const run = this.repository.createRun({
      work_item_id: workItem.id,
      goal_id: workItem.goal_id,
      agent_type: workItem.assigned_agent || 'default',
      run_sequence: runSequence,
    });

    try {
      const agentResult = await this.reactIntegration.executeWorkCycle({
        workItem,
        run,
        goal,
        signal: new AbortController().signal,
        model: workItem.context?.model,
        toolEnforcer: scopedToolEnforcer,
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

  private createScopedToolEnforcer(workItem: WorkItem): ToolEnforcer | undefined {
    const allowlistOverride = workItem.context?.tool_allowlist;

    if (!Array.isArray(allowlistOverride)) {
      return undefined;
    }

    const scopedAllowlist = new ToolAllowlist(allowlistOverride);
    return new ToolEnforcer(this.toolRegistry, scopedAllowlist);
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

  private async preSearchSkills(workItem: WorkItem): Promise<void> {
    try {
      const keywords = this.extractKeywords(workItem.description);
      if (keywords.length === 0) return;

      const suggestedSkills: any[] = [];
      const searchLimit = Math.min(keywords.length, 3);

      for (let i = 0; i < searchLimit; i++) {
        const keyword = keywords[i];
        try {
          const searchResult = await findSkillsTool.execute(
            {
              query: keyword,
              install: false,
              limit: 2,
            },
            { cwd: process.cwd(), allowlist: this.toolAllowlist, enforcer: this.toolEnforcer }
          );

          const parsed = JSON.parse(searchResult);
          if (parsed.skills && Array.isArray(parsed.skills) && parsed.skills.length > 0) {
            suggestedSkills.push(...parsed.skills);
          }
        } catch (error) {
          console.warn(`[ExecutionService] Skill pre-search failed for "${keyword}":`, error);
        }
      }

      if (suggestedSkills.length > 0) {
        const uniqueSkills = this.deduplicateSkills(suggestedSkills);
        workItem.context = {
          ...workItem.context,
          suggestedSkills: uniqueSkills.slice(0, 5),
        };
        console.log(`[ExecutionService] Pre-searched ${uniqueSkills.length} skills for work item ${workItem.id}`);
      }
    } catch (error) {
      console.warn('[ExecutionService] Skill pre-search failed:', error);
    }
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how']);
    
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));
    
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 5);
  }

  private deduplicateSkills(skills: any[]): any[] {
    const seen = new Set<string>();
    const unique: any[] = [];
    
    for (const skill of skills) {
      const key = skill.name || skill.url;
      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(skill);
      }
    }
    
    return unique;
  }
}
