import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IExecutionService, ExecutionResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { ReActIntegration } from '../../../autonomy/react-integration.js';
import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../../../infra/tools/tool-registry.js';
import type { ToolPolicyAuditSnapshot } from '../../../infra/tools/tool-registry.js';
import type { LayeredToolPolicy, ToolPolicyContext } from '../../../infra/tools/layered-tool-policy.js';
import { ToolProvider, setGlobalToolProvider } from '../../../infra/tools/tool-provider.js';
import { ReadFileTool } from '../../../infra/tools/implementations/read-file-tool.js';
import { WriteFileTool } from '../../../infra/tools/implementations/write-file-tool.js';
import { ExecuteCommandTool } from '../../../infra/tools/implementations/execute-command-tool.js';
import { SearchCodeTool } from '../../../infra/tools/implementations/search-code-tool.js';
import { WebSearchTool } from '../../../infra/tools/implementations/web-search-tool.js';
import { findSkillsTool } from '../../../infra/tools/implementations/find-skills-tool.js';
import { getGlobalSkillRegistry } from '../../../infra/skills/skill-registry.js';
import { initializeMCPIntegration } from '../../../infra/mcp/adapters/registry-integration.js';
import { routeContextFromWorkItemContext } from '../../../infra/routing/route-context.js';

interface ScopedToolEnforcerConfig {
  enforcer: ToolEnforcer;
  policyAudit: ToolPolicyAuditSnapshot;
}

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
    this.normalizeWorkItemRouteContext(workItem);

    const scopedToolConfig = this.createScopedToolEnforcer(workItem);
    const scopedToolEnforcer = scopedToolConfig?.enforcer;
    if (scopedToolConfig) {
      this.attachToolPolicyAudit(workItem, scopedToolConfig.policyAudit);
    }

    const routeContext = routeContextFromWorkItemContext(workItem.context);

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

      const executionLog = this.buildExecutionLogWithPolicyAudit(
        agentResult.log,
        scopedToolConfig?.policyAudit,
        routeContext
      );

      this.repository.completeRun(run.id, {
        status: agentResult.success ? 'success' : 'failure',
        error_message: agentResult.error,
        tokens_used: agentResult.tokensUsed,
        time_seconds: timeSeconds,
        cost_usd: agentResult.costUsd,
        artifacts: agentResult.artifactIds || [],
        execution_log: executionLog,
      });

      this.persistToolPolicyDecision(run, workItem, scopedToolConfig?.policyAudit, routeContext);

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
        execution_log: this.buildExecutionLogWithPolicyAudit(
          `Execution failed before completion: ${String(error)}`,
          scopedToolConfig?.policyAudit,
          routeContext
        ),
      });

      this.persistToolPolicyDecision(run, workItem, scopedToolConfig?.policyAudit, routeContext);

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

  private createScopedToolEnforcer(workItem: WorkItem): ScopedToolEnforcerConfig | undefined {
    const allowlistOverride = workItem.context?.tool_allowlist;
    const layeredPolicy = this.extractLayeredToolPolicy(workItem);
    const policyContext = this.extractToolPolicyContext(workItem);

    const hasAllowlistOverride = Array.isArray(allowlistOverride);
    const hasLayeredPolicy = layeredPolicy !== undefined;

    if (!hasAllowlistOverride && !hasLayeredPolicy) {
      return undefined;
    }

    const scopedAllowlist = new ToolAllowlist(
      hasAllowlistOverride ? allowlistOverride : this.toolAllowlist.getAllowedTools()
    );

    const enforcer = new ToolEnforcer(this.toolRegistry, scopedAllowlist, {
      layeredPolicy,
      policyContext,
    });

    return {
      enforcer,
      policyAudit: enforcer.getPolicyAuditSnapshot(),
    };
  }

  private normalizeWorkItemRouteContext(workItem: WorkItem): void {
    const routeContext = routeContextFromWorkItemContext(workItem.context);
    if (!routeContext) {
      return;
    }

    workItem.context = {
      ...(workItem.context ?? {}),
      routeContext,
    };
  }

  private attachToolPolicyAudit(workItem: WorkItem, policyAudit: ToolPolicyAuditSnapshot): void {
    workItem.context = {
      ...(workItem.context ?? {}),
      tool_policy_audit: policyAudit,
    };
  }

  private buildExecutionLogWithPolicyAudit(
    executionLog: string | undefined,
    policyAudit: ToolPolicyAuditSnapshot | undefined,
    routeContext: ReturnType<typeof routeContextFromWorkItemContext>
  ): string {
    const logs: string[] = [];

    if (policyAudit) {
      logs.push(
        `[POLICY_AUDIT] layered=${policyAudit.hasLayeredPolicy} layers=${policyAudit.appliedLayers.join(',') || 'none'} baseline=${policyAudit.baselineAllowedTools.length} effective=${policyAudit.effectiveAllowedTools.length} denied=${policyAudit.deniedTools.length}`
      );
    }

    if (routeContext) {
      logs.push(
        `[ROUTE_CONTEXT] source=${routeContext.source} provider=${routeContext.providerId || 'unspecified'} channel=${routeContext.channel || 'unspecified'} owner=${routeContext.senderIsOwner === true ? 'true' : 'false'} sandboxed=${routeContext.sandboxed === true ? 'true' : 'false'}`
      );
    }

    if (executionLog && executionLog.trim().length > 0) {
      logs.push(executionLog);
    }

    return logs.join('\n');
  }

  private persistToolPolicyDecision(
    run: Run,
    workItem: WorkItem,
    policyAudit: ToolPolicyAuditSnapshot | undefined,
    routeContext: ReturnType<typeof routeContextFromWorkItemContext>
  ): void {
    if (!policyAudit) {
      return;
    }

    try {
      this.repository.createDecision({
        run_id: run.id,
        work_item_id: workItem.id,
        goal_id: workItem.goal_id,
        decision_type: 'tool',
        decision_point: 'tool_policy_resolution',
        options_considered: [
          {
            label: 'baseline_allowlist',
            description: `Baseline allowed tools: ${policyAudit.baselineAllowedTools.join(', ') || 'none'}`,
          },
          {
            label: 'effective_tool_envelope',
            description: `Effective tools after policy resolution: ${policyAudit.effectiveAllowedTools.join(', ') || 'none'}`,
          },
        ],
        selected_option: policyAudit.hasLayeredPolicy ? 'layered_policy_applied' : 'allowlist_only',
        reasoning:
          `Applied layers: ${policyAudit.appliedLayers.join(' -> ') || 'none'}; ` +
          `Denied tools: ${policyAudit.deniedTools.map((item) => `${item.tool}(${item.reason})`).join(', ') || 'none'}`,
        metadata: {
          policyAudit,
          routeContext,
        },
      });
    } catch (error) {
      console.warn('[ExecutionService] Failed to persist tool policy decision:', error);
    }
  }

  private extractLayeredToolPolicy(workItem: WorkItem): LayeredToolPolicy | undefined {
    const context = workItem.context;
    if (!context || typeof context !== 'object') {
      return undefined;
    }

    const explicitPolicy = context.tool_policy;
    if (this.isLayeredToolPolicy(explicitPolicy)) {
      return explicitPolicy;
    }

    const policySnapshot = context.policy_snapshot;
    if (!policySnapshot || typeof policySnapshot !== 'object') {
      return undefined;
    }

    const toolAllowlist = this.toStringArray((policySnapshot as Record<string, unknown>).toolAllowlist);
    if (toolAllowlist.length === 0) {
      return undefined;
    }

    return {
      global: {
        allow: toolAllowlist,
      },
    };
  }

  private extractToolPolicyContext(workItem: WorkItem): ToolPolicyContext {
    const context = workItem.context;
    const routeContext = routeContextFromWorkItemContext(context);
    const policyContextFromWorkItem =
      context && typeof context === 'object' && typeof context.tool_policy_context === 'object' && context.tool_policy_context !== null
        ? (context.tool_policy_context as Record<string, unknown>)
        : {};

    const providerId = this.getString(policyContextFromWorkItem.providerId)
      ?? this.getString(policyContextFromWorkItem.provider_id)
      ?? routeContext?.providerId
      ?? this.getString(context?.model);
    const agentId = this.getString(policyContextFromWorkItem.agentId)
      ?? this.getString(policyContextFromWorkItem.agent_id)
      ?? routeContext?.agentId
      ?? workItem.assigned_agent;

    const isSubagent = this.getBoolean(policyContextFromWorkItem.isSubagent)
      ?? this.getBoolean(policyContextFromWorkItem.is_subagent)
      ?? routeContext?.isSubagent
      ?? this.getBoolean(context?.is_subagent)
      ?? false;
    const sandboxed = this.getBoolean(policyContextFromWorkItem.sandboxed)
      ?? this.getBoolean(policyContextFromWorkItem.isSandboxed)
      ?? routeContext?.sandboxed
      ?? this.getBoolean(context?.sandboxed)
      ?? false;
    const isOwner = this.getBoolean(policyContextFromWorkItem.isOwner)
      ?? this.getBoolean(policyContextFromWorkItem.is_owner)
      ?? routeContext?.senderIsOwner
      ?? this.getBoolean(context?.sender_is_owner)
      ?? false;

    return {
      providerId,
      agentId,
      isSubagent,
      sandboxed,
      isOwner,
    };
  }

  private isLayeredToolPolicy(value: unknown): value is LayeredToolPolicy {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    const supportedKeys = [
      'profiles',
      'groups',
      'global',
      'byProvider',
      'byAgent',
      'subagent',
      'sandbox',
      'ownerOnlyTools',
    ];

    return supportedKeys.some((key) => key in record);
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private getBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
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
