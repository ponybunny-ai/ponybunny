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
import { extractMCPToolName } from '../../../infra/mcp/adapters/tool-adapter.js';
import { routeContextFromWorkItemContext } from '../../../infra/routing/route-context.js';
import { getManagedSkillsDir } from '../../../infra/config/config-paths.js';

interface ScopedToolEnforcerConfig {
  enforcer: ToolEnforcer;
  policyAudit: ToolPolicyAuditSnapshot;
}

interface ResourcePolicyConfig {
  available: string[];
  denied: string[];
}

interface McpSelector {
  serverPattern: string;
  toolPattern: string;
}

interface ResourceSelectionResult {
  blocked: boolean;
  reason?: string;
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
    const managedSkillsDir = getManagedSkillsDir();
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

    const humanApprovalGate = this.evaluateHumanApprovalGate(workItem, routeContext);
    if (!humanApprovalGate.allowed) {
      const runSequence = this.repository.getRunsByWorkItem(workItem.id).length + 1;
      const run = this.repository.createRun({
        work_item_id: workItem.id,
        goal_id: workItem.goal_id,
        agent_type: workItem.assigned_agent || 'default',
        run_sequence: runSequence,
      });

      try {
        this.repository.createEscalation({
          work_item_id: workItem.id,
          goal_id: workItem.goal_id,
          run_id: run.id,
          escalation_type: 'risk',
          severity: 'medium',
          title: 'Human approval required',
          description: humanApprovalGate.reason,
        });
      } catch (error) {
        console.warn('[ExecutionService] Failed to persist human approval escalation:', error);
      }

      this.repository.completeRun(run.id, {
        status: 'failure',
        error_message: humanApprovalGate.reason,
        tokens_used: 0,
        time_seconds: 0,
        cost_usd: 0,
        artifacts: [],
        execution_log: humanApprovalGate.reason,
      });

      return {
        run: this.repository.getRun(run.id)!,
        success: false,
        needsRetry: false,
        errorSignature: this.generateErrorSignature(humanApprovalGate.reason),
      };
    }

    const resourceSelection = await this.applyResourcePolicySelection(workItem);
    if (resourceSelection.blocked) {
      const runSequence = this.repository.getRunsByWorkItem(workItem.id).length + 1;
      const run = this.repository.createRun({
        work_item_id: workItem.id,
        goal_id: workItem.goal_id,
        agent_type: workItem.assigned_agent || 'default',
        run_sequence: runSequence,
      });

      const reason = resourceSelection.reason ?? 'Resource selection requires user narrowing input.';
      try {
        this.repository.createEscalation({
          work_item_id: workItem.id,
          goal_id: workItem.goal_id,
          run_id: run.id,
          escalation_type: 'ambiguous',
          severity: 'medium',
          title: 'Need narrowing for skill/MCP/tool selection',
          description: reason,
        });
      } catch (error) {
        console.warn('[ExecutionService] Failed to persist resource selection escalation:', error);
      }

      this.repository.completeRun(run.id, {
        status: 'failure',
        error_message: reason,
        tokens_used: 0,
        time_seconds: 0,
        cost_usd: 0,
        artifacts: [],
        execution_log: reason,
      });

      return {
        run: this.repository.getRun(run.id)!,
        success: false,
        needsRetry: false,
        errorSignature: this.generateErrorSignature(reason),
      };
    }

    if (process.env.PONY_SKILL_AUTO_DISCOVERY !== 'false') {
      await this.preSearchSkills(workItem);
    }

    const runSequence = this.repository.getRunsByWorkItem(workItem.id).length + 1;
    const run = this.repository.createRun({
      work_item_id: workItem.id,
      goal_id: workItem.goal_id,
      agent_type: workItem.assigned_agent || 'default',
      run_sequence: runSequence,
      context: {
        selected_model: workItem.context?.selected_model,
        requested_model: workItem.context?.model,
      },
    });

    let agentResult: Awaited<ReturnType<ReActIntegration['executeWorkCycle']>>;

    try {
      agentResult = await this.reactIntegration.executeWorkCycle({
        workItem,
        run,
        goal,
        signal: new AbortController().signal,
        model: workItem.context?.model,
        toolEnforcer: scopedToolEnforcer,
      });
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
      context: {
        selected_model: workItem.context?.selected_model,
        requested_model: workItem.context?.model,
        actual_model: agentResult.actualModel,
        endpoint_id: agentResult.endpointId,
      },
    });

    this.persistToolPolicyDecision(run, workItem, scopedToolConfig?.policyAudit, routeContext);

    try {
      this.repository.updateGoalSpending(
        workItem.goal_id,
        agentResult.tokensUsed,
        Math.ceil(timeSeconds / 60),
        agentResult.costUsd
      );
    } catch (error) {
      console.warn('[ExecutionService] Failed to update goal spending after run completion:', error);
    }

    const persistedRun = this.repository.getRun(run.id) ?? run;
    const needsRetry = !agentResult.success && !this.shouldEscalateError(workItem);
    const errorSignature = this.generateErrorSignature(agentResult.error);

    return {
      run: persistedRun,
      success: agentResult.success,
      needsRetry,
      errorSignature,
    };
  }

  private evaluateHumanApprovalGate(
    workItem: WorkItem,
    routeContext: ReturnType<typeof routeContextFromWorkItemContext>
  ): { allowed: true } | { allowed: false; reason: string } {
    const context = workItem.context;
    if (!context || typeof context !== 'object') {
      return { allowed: true };
    }

    const approvalRequired = context.approval_required === true;
    if (!approvalRequired) {
      return { allowed: true };
    }

    const approvalGranted = context.approval_granted === true;
    if (approvalGranted) {
      return { allowed: true };
    }

    if (routeContext?.senderIsOwner === true) {
      return { allowed: true };
    }

    const actions = Array.isArray(context.approval_actions)
      ? context.approval_actions.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    const actionLabel = actions.length > 0 ? actions.join(', ') : 'manual approval';

    return {
      allowed: false,
      reason: `Human approval required before execution. Pending actions: ${actionLabel}`,
    };
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
      const policySnapshot = this.getPolicySnapshot(workItem);
      const skillPolicy = this.getResourcePolicy(policySnapshot?.skills);
      const hasPreferredSkills = skillPolicy.available.length > 0;
      const localSkillNames = this.skillRegistry.getSkills().map((skill) => skill.name);
      const localPreferred = this.filterBySelectors(localSkillNames, skillPolicy.available);

      if (hasPreferredSkills && localPreferred.length === 0) {
        const webSearchTool = this.toolRegistry.getTool('web_search');
        if (webSearchTool) {
          const queryHint = this.extractKeywords(workItem.description).slice(0, 2).join(' ');
          const skillSearchResult = await webSearchTool.execute(
            {
              query: `best PonyBunny skill ${queryHint}`,
              count: 5,
            },
            { cwd: process.cwd(), allowlist: this.toolAllowlist, enforcer: this.toolEnforcer }
          );

          workItem.context = {
            ...(workItem.context ?? {}),
            external_skill_discovery: this.removeDeniedMentions(skillSearchResult, skillPolicy.denied),
          };
        }
      }

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
            const filtered = parsed.skills.filter((skill: { name?: unknown }) => {
              const skillName = skill.name;
              if (typeof skillName !== 'string') {
                return false;
              }
              if (skillPolicy.denied.some((selector) => this.matchesSelector(skillName, selector))) {
                return false;
              }
              if (skillPolicy.available.length > 0) {
                return skillPolicy.available.some((selector) => this.matchesSelector(skillName, selector));
              }
              return true;
            });

            suggestedSkills.push(...filtered);
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

  private async applyResourcePolicySelection(workItem: WorkItem): Promise<ResourceSelectionResult> {
    const policySnapshot = this.getPolicySnapshot(workItem);
    if (!policySnapshot) {
      return { blocked: false };
    }

    const skillPolicy = this.getResourcePolicy(policySnapshot.skills);
    const mcpPolicy = this.getResourcePolicy(policySnapshot.mcp);
    const keywords = this.extractKeywords(`${workItem.title} ${workItem.description}`);

    const skillCandidates = this.rankCandidates(
      this.filterByPolicy(
        this.skillRegistry.getSkills().map((skill) => skill.name),
        skillPolicy
      ),
      keywords
    );

    const mcpTools = this.toolRegistry.getAllTools().map((tool) => tool.name).filter((name) => name.startsWith('mcp__'));
    const mcpCandidates = this.rankCandidates(
      this.filterMcpToolsByPolicy(mcpTools, mcpPolicy),
      keywords
    );

    const selectedSkillOverride = this.getString(workItem.context?.selected_skill_override);
    const selectedMcpOverride = this.getString(workItem.context?.selected_mcp_tool_override);

    const selectedSkill = selectedSkillOverride
      ?? (skillCandidates.length > 0 ? skillCandidates[0] : undefined);
    const selectedMcpTool = selectedMcpOverride
      ?? (mcpCandidates.length > 0 ? mcpCandidates[0] : undefined);

    const ambiguousSkillCandidates = selectedSkillOverride ? [] : skillCandidates.slice(0, 5);
    const ambiguousMcpCandidates = selectedMcpOverride ? [] : mcpCandidates.slice(0, 5);

    if (ambiguousSkillCandidates.length > 3 || ambiguousMcpCandidates.length > 3) {
      return {
        blocked: true,
        reason:
          'Too many resource candidates. Provide selected_skill_override or selected_mcp_tool_override via escalation response data. '
          + `skills=[${ambiguousSkillCandidates.join(', ') || 'none'}], mcp=[${ambiguousMcpCandidates.join(', ') || 'none'}]`,
      };
    }

    const baseAllowlist = this.toStringArray(workItem.context?.tool_allowlist);
    const selectedAllowlist = baseAllowlist.filter((toolName) => {
      if (!toolName.startsWith('mcp__')) {
        return true;
      }
      if (selectedMcpTool) {
        return toolName === selectedMcpTool;
      }
      return mcpCandidates.includes(toolName);
    });

    workItem.context = {
      ...(workItem.context ?? {}),
      selected_skill: selectedSkill,
      selected_mcp_tool: selectedMcpTool,
      candidate_skills: skillCandidates.slice(0, 5),
      candidate_mcp_tools: mcpCandidates.slice(0, 5),
      tool_allowlist: selectedAllowlist,
    };

    if (mcpPolicy.available.length > 0 && mcpCandidates.length === 0) {
      const webSearchTool = this.toolRegistry.getTool('web_search');
      if (webSearchTool) {
        const queryHint = keywords.slice(0, 2).join(' ');
        const mcpSearchResult = await webSearchTool.execute(
          {
            query: `best MCP server ${queryHint}`,
            count: 5,
          },
          { cwd: process.cwd(), allowlist: this.toolAllowlist, enforcer: this.toolEnforcer }
        );

        workItem.context = {
          ...(workItem.context ?? {}),
          external_mcp_discovery: this.removeDeniedMentions(mcpSearchResult, mcpPolicy.denied),
        };
      }
    }

    return { blocked: false };
  }

  private getPolicySnapshot(workItem: WorkItem): Record<string, unknown> | undefined {
    const snapshot = workItem.context?.policy_snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return undefined;
    }
    return snapshot as Record<string, unknown>;
  }

  private getResourcePolicy(value: unknown): ResourcePolicyConfig {
    if (!value || typeof value !== 'object') {
      return { available: [], denied: [] };
    }

    const record = value as Record<string, unknown>;
    return {
      available: this.toStringArray(record.available),
      denied: this.toStringArray(record.denied),
    };
  }

  private filterByPolicy(candidates: string[], policy: ResourcePolicyConfig): string[] {
    const byAvailable = policy.available.length > 0
      ? candidates.filter((name) => policy.available.some((selector) => this.matchesSelector(name, selector)))
      : candidates;

    return byAvailable.filter((name) => !policy.denied.some((selector) => this.matchesSelector(name, selector)));
  }

  private filterMcpToolsByPolicy(candidates: string[], policy: ResourcePolicyConfig): string[] {
    const availableSelectors = policy.available
      .map((selector) => this.parseMcpSelector(selector))
      .filter((selector): selector is McpSelector => selector !== undefined);
    const deniedSelectors = policy.denied
      .map((selector) => this.parseMcpSelector(selector))
      .filter((selector): selector is McpSelector => selector !== undefined);

    return candidates.filter((toolName) => {
      const parsed = extractMCPToolName(toolName);
      if (!parsed) {
        return false;
      }

      if (deniedSelectors.some((selector) => this.matchesMcpSelector(parsed.serverName, parsed.toolName, selector))) {
        return false;
      }

      if (policy.available.length === 0) {
        return true;
      }

      return availableSelectors.some((selector) => this.matchesMcpSelector(parsed.serverName, parsed.toolName, selector));
    });
  }

  private parseMcpSelector(selector: string): McpSelector | undefined {
    const trimmed = selector.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const dotIndex = trimmed.indexOf('.');
    if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
      return undefined;
    }

    const serverPattern = trimmed.slice(0, dotIndex).trim();
    const toolPattern = trimmed.slice(dotIndex + 1).trim();
    if (serverPattern.length === 0 || toolPattern.length === 0) {
      return undefined;
    }

    return { serverPattern, toolPattern };
  }

  private matchesMcpSelector(serverName: string, toolName: string, selector: McpSelector): boolean {
    return this.matchesSelector(serverName, selector.serverPattern)
      && this.matchesSelector(toolName, selector.toolPattern);
  }

  private rankCandidates(candidates: string[], keywords: string[]): string[] {
    const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
    return [...candidates].sort((left, right) => {
      const leftScore = lowerKeywords.reduce((score, keyword) => score + (left.toLowerCase().includes(keyword) ? 1 : 0), 0);
      const rightScore = lowerKeywords.reduce((score, keyword) => score + (right.toLowerCase().includes(keyword) ? 1 : 0), 0);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return left.localeCompare(right);
    });
  }

  private filterBySelectors(candidates: string[], selectors: string[]): string[] {
    if (selectors.length === 0) {
      return candidates;
    }

    return candidates.filter((candidate) => selectors.some((selector) => this.matchesSelector(candidate, selector)));
  }

  private matchesSelector(value: string, selector: string): boolean {
    const normalizedSelector = selector.trim();
    if (normalizedSelector.length === 0) {
      return false;
    }

    const escaped = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(value);
  }

  private removeDeniedMentions(content: string, deniedSelectors: string[]): string {
    let sanitized = content;
    for (const selector of deniedSelectors) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
      const regex = new RegExp(escaped, 'ig');
      sanitized = sanitized.replace(regex, '[DENIED_FILTERED]');
    }
    return sanitized;
  }
}
