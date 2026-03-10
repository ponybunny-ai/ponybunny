import type { WorkItem, Run } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IExecutionService, ExecutionResult } from '../stage-interfaces.js';
import type { ILLMProvider } from '../../../infra/llm/llm-provider.js';
import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../../../infra/tools/tool-registry.js';
import type { ToolPolicyAuditSnapshot } from '../../../infra/tools/tool-registry.js';
import { ReadFileTool } from '../../../infra/tools/implementations/read-file-tool.js';
import { WriteFileTool } from '../../../infra/tools/implementations/write-file-tool.js';
import { ExecuteCommandTool } from '../../../infra/tools/implementations/execute-command-tool.js';
import { SearchCodeTool } from '../../../infra/tools/implementations/search-code-tool.js';
import { WebSearchTool } from '../../../infra/tools/implementations/web-search-tool.js';
import { findSkillsTool } from '../../../infra/tools/implementations/find-skills-tool.js';
import { getGlobalSkillRegistry } from '../../../infra/skills/skill-registry.js';
import { initializeMCPIntegration } from '../../../infra/mcp/adapters/registry-integration.js';
import { routeContextFromWorkItemContext } from '../../../infra/routing/route-context.js';
import { getManagedSkillsDir } from '../../../infra/config/config-paths.js';
import type { ExecutionRunner } from '../../../runtime/execution-boundary/execution-runner.js';
import {
  LocalExecutionToolPolicyPreparer,
  LocalExecutionCycleRuntimeFactory,
  LocalExecutionResourcePreparer,
  type ExecutionToolPolicyPreparer,
  type ExecutionResourcePreparer,
  type ExecutionCycleRunner,
  type ExecutionCycleRuntimeFactory,
} from '../../../runtime/execution-boundary/index.js';
import type { RuntimeToolingContext } from '../../../runtime/tooling-context/index.js';

interface ExecutionServiceRuntimeDeps {
  executionCycleRunner?: ExecutionCycleRunner;
  executionCycleRuntimeFactory?: ExecutionCycleRuntimeFactory;
  executionToolPolicyPreparer?: ExecutionToolPolicyPreparer;
  executionResourcePreparer?: ExecutionResourcePreparer;
}

export class ExecutionService implements IExecutionService, ExecutionRunner {
  private toolRegistry: ToolRegistry;
  private toolAllowlist: ToolAllowlist;
  private toolEnforcer: ToolEnforcer;
  private skillRegistry = getGlobalSkillRegistry();
  private runtimeToolingContext: RuntimeToolingContext;
  private executionCycleRunner: ExecutionCycleRunner;
  private executionToolPolicyPreparer: ExecutionToolPolicyPreparer;
  private executionResourcePreparer: ExecutionResourcePreparer;
  private mcpInitialized = false;

  constructor(
    private repository: IWorkOrderRepository,
    private config: {
      maxConsecutiveErrors: number;
    },
    llmProvider?: ILLMProvider,
    runtimeDeps: ExecutionServiceRuntimeDeps = {}
  ) {
    this.toolRegistry = new ToolRegistry();
    this.toolAllowlist = new ToolAllowlist();

    this.registerTools();

    this.toolEnforcer = new ToolEnforcer(this.toolRegistry, this.toolAllowlist);
    const executionCycleRuntimeFactory = runtimeDeps.executionCycleRuntimeFactory
      ?? new LocalExecutionCycleRuntimeFactory();
    this.executionToolPolicyPreparer = runtimeDeps.executionToolPolicyPreparer
      ?? new LocalExecutionToolPolicyPreparer({
        toolRegistry: this.toolRegistry,
        toolAllowlist: this.toolAllowlist,
      });
    this.executionResourcePreparer = runtimeDeps.executionResourcePreparer
      ?? new LocalExecutionResourcePreparer({
        skillRegistry: this.skillRegistry,
        toolRegistry: this.toolRegistry,
        toolAllowlist: this.toolAllowlist,
        toolEnforcer: this.toolEnforcer,
      });
    const executionCycleRuntime = executionCycleRuntimeFactory.createExecutionCycleRuntime({
      llmProvider,
      toolRegistry: this.toolRegistry,
      toolAllowlist: this.toolAllowlist,
      toolEnforcer: this.toolEnforcer,
      skillRegistry: this.skillRegistry,
    });

    this.runtimeToolingContext = executionCycleRuntime.runtimeToolingContext;
    this.runtimeToolingContext.syncLegacyGlobals();
    this.executionCycleRunner = runtimeDeps.executionCycleRunner
      ?? executionCycleRuntime.executionCycleRunner;
  }

  getRuntimeToolingContext(): RuntimeToolingContext {
    return this.runtimeToolingContext;
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

    const preparedToolPolicy = this.executionToolPolicyPreparer.prepareForWorkItem(workItem);
    const scopedToolEnforcer = preparedToolPolicy?.toolEnforcer;
    if (preparedToolPolicy) {
      this.attachToolPolicyAudit(workItem, preparedToolPolicy.policyAudit);
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

    const resourceSelection = await this.executionResourcePreparer.prepareForWorkItem(workItem);
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

    let agentResult: Awaited<ReturnType<ExecutionCycleRunner['executeCycle']>>;

    try {
      agentResult = await this.executionCycleRunner.executeCycle({
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
          preparedToolPolicy?.policyAudit,
          routeContext
        ),
      });

      this.persistToolPolicyDecision(run, workItem, preparedToolPolicy?.policyAudit, routeContext);

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
      preparedToolPolicy?.policyAudit,
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

    this.persistToolPolicyDecision(run, workItem, preparedToolPolicy?.policyAudit, routeContext);

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

  private getBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }
}
