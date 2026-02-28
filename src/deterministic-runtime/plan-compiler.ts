import type { ToolRegistry } from '../infra/tools/tool-registry.js';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import { DeterministicRuntimeErrorCodes, type DeterministicRuntimeErrorCode } from './error-codes.js';
import { DeterministicSchemaValidator } from './schema-validator.js';

export interface PlanStepV1 {
  id: string;
  type: 'tool_call' | 'transform' | 'human_confirm' | 'script_generate' | 'script_execute';
  depends_on?: string[];
  reads?: string[];
  writes?: string[];
  tool_ref?: string;
  args?: Record<string, unknown>;
  message?: string;
  language?: 'applescript' | 'bash';
  goal?: string;
  script_ref?: string;
  timeout_ms?: number;
}

export interface PlanV1 {
  schema_version: 'plan.v1';
  plan_id: string;
  goal: string;
  steps: PlanStepV1[];
  [key: string]: unknown;
}

export interface AcceptedPlan {
  schemaVersion: 'plan.v1';
  planId: string;
  goal: string;
  acceptedAt: number;
  steps: PlanStepV1[];
  original: PlanV1;
}

export interface CompileError {
  code: DeterministicRuntimeErrorCode;
  message: string;
  path: string;
  stepId?: string;
}

export interface CompileResult {
  ok: boolean;
  acceptedPlan?: AcceptedPlan;
  errors: CompileError[];
}

interface RuntimePolicyProfile {
  tool_routing?: {
    mode?: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
    allow_model_native_tools?: boolean;
    resolution_order?: string[];
  };
  policy?: {
    default_network?: 'allow' | 'deny';
    default_filesystem_scope?: {
      read?: string[];
      write?: string[];
    };
    tool_allowlist?: string[];
    tool_denylist?: string[];
    require_human_approval_for?: string[];
    script_sandbox?: {
      allowed_languages?: string[];
      no_network?: boolean;
      allowed_apps?: string[];
      max_runtime_ms?: number;
      max_output_bytes?: number;
    };
  };
}

export class PlanCompiler {
  private readonly toolArgsAjv = new Ajv2020({ allErrors: true, strict: false });
  private readonly toolArgsValidators = new Map<string, ValidateFunction>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly schemaValidator: DeterministicSchemaValidator = new DeterministicSchemaValidator()
  ) {}

  compile(plan: unknown, runtimeProfile?: unknown): CompileResult {
    const errors: CompileError[] = [];

    const schemaErrors = this.validateSchema(plan);
    errors.push(...schemaErrors);
    if (schemaErrors.length > 0) {
      return { ok: false, errors: this.sortErrors(errors) };
    }

    const normalizedPlan = plan as PlanV1;

    const runtimeProfileErrors = this.validateRuntimeProfileSchema(runtimeProfile);
    errors.push(...runtimeProfileErrors);
    if (runtimeProfileErrors.length > 0) {
      return { ok: false, errors: this.sortErrors(errors) };
    }

    const dependencyErrors = this.validateDependencies(normalizedPlan);
    errors.push(...dependencyErrors);

    const dagErrors = this.validateDag(normalizedPlan);
    errors.push(...dagErrors);

    const toolErrors = this.validateTools(normalizedPlan);
    errors.push(...toolErrors);

    const argsErrors = this.validateToolArgs(normalizedPlan);
    errors.push(...argsErrors);

    const policyErrors = this.validatePolicy(normalizedPlan, runtimeProfile);
    errors.push(...policyErrors);

    if (errors.length > 0) {
      return { ok: false, errors: this.sortErrors(errors) };
    }

    const acceptedPlan: AcceptedPlan = {
      schemaVersion: 'plan.v1',
      planId: normalizedPlan.plan_id,
      goal: normalizedPlan.goal,
      acceptedAt: Date.now(),
      steps: [...normalizedPlan.steps],
      original: normalizedPlan,
    };

    return {
      ok: true,
      acceptedPlan,
      errors: [],
    };
  }

  private validateSchema(plan: unknown): CompileError[] {
    const schemaResult = this.schemaValidator.validate('plan', plan);
    if (schemaResult.valid) {
      return [];
    }

    return schemaResult.errors.map((error) => ({
      code: DeterministicRuntimeErrorCodes.ERR_PLAN_SCHEMA_INVALID,
      message: error.message,
      path: error.path,
    }));
  }

  private validateRuntimeProfileSchema(runtimeProfile?: unknown): CompileError[] {
    if (runtimeProfile === undefined) {
      return [];
    }

    const schemaResult = this.schemaValidator.validate('runtime_profile', runtimeProfile);
    if (schemaResult.valid) {
      return [];
    }

    return schemaResult.errors.map((error) => ({
      code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
      message: `runtime profile invalid: ${error.message}`,
      path: error.path,
    }));
  }

  private validateDependencies(plan: PlanV1): CompileError[] {
    const errors: CompileError[] = [];
    const stepCounts = new Map<string, number>();
    for (const step of plan.steps) {
      stepCounts.set(step.id, (stepCounts.get(step.id) ?? 0) + 1);
    }

    const duplicateStepIds = new Set(
      [...stepCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([stepId]) => stepId)
    );

    for (const duplicateStepId of duplicateStepIds) {
      errors.push({
        code: DeterministicRuntimeErrorCodes.ERR_STEP_ID_DUPLICATE,
        message: `duplicate step id '${duplicateStepId}' is not allowed`,
        path: '/steps',
        stepId: duplicateStepId,
      });
    }

    const stepIds = new Set(stepCounts.keys());

    for (const step of plan.steps) {
      for (const depId of step.depends_on ?? []) {
        if (depId === step.id) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_STEP_DEPENDENCY_INVALID,
            message: `step '${step.id}' cannot depend on itself`,
            path: '/steps',
            stepId: step.id,
          });
          continue;
        }

        if (!stepIds.has(depId)) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_STEP_DEPENDENCY_INVALID,
            message: `step '${step.id}' depends on missing step '${depId}'`,
            path: '/steps',
            stepId: step.id,
          });
        }
      }
    }

    return errors;
  }

  private validateDag(plan: PlanV1): CompileError[] {
    const graph = new Map<string, string[]>();
    for (const step of plan.steps) {
      graph.set(step.id, step.depends_on ?? []);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const cycleErrors: CompileError[] = [];

    const visit = (stepId: string): void => {
      if (cycleErrors.length > 0) {
        return;
      }

      if (visiting.has(stepId)) {
        cycleErrors.push({
          code: DeterministicRuntimeErrorCodes.ERR_STEP_CYCLE_DETECTED,
          message: `cycle detected at step '${stepId}'`,
          path: '/steps',
          stepId,
        });
        return;
      }

      if (visited.has(stepId)) {
        return;
      }

      visiting.add(stepId);
      for (const dep of graph.get(stepId) ?? []) {
        if (graph.has(dep)) {
          visit(dep);
        }
      }
      visiting.delete(stepId);
      visited.add(stepId);
    };

    for (const step of plan.steps) {
      visit(step.id);
      if (cycleErrors.length > 0) {
        break;
      }
    }

    return cycleErrors;
  }

  private validateTools(plan: PlanV1): CompileError[] {
    const errors: CompileError[] = [];

    for (const step of plan.steps) {
      if (step.type !== 'tool_call') {
        continue;
      }

      const toolName = this.resolveToolName(step.tool_ref);
      if (!toolName || !this.registry.hasTool(toolName)) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_TOOL_NOT_FOUND,
          message: `tool not found for step '${step.id}' (${step.tool_ref ?? 'undefined'})`,
          path: '/steps',
          stepId: step.id,
        });
      }
    }

    return errors;
  }

  private validateToolArgs(plan: PlanV1): CompileError[] {
    const errors: CompileError[] = [];

    for (const step of plan.steps) {
      if (step.type !== 'tool_call') {
        continue;
      }

      if (!step.args || typeof step.args !== 'object' || Array.isArray(step.args)) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_TOOL_ARGS_INVALID,
          message: `tool args must be an object for step '${step.id}'`,
          path: '/steps',
          stepId: step.id,
        });
        continue;
      }

      const toolName = this.resolveToolName(step.tool_ref);
      if (!toolName) {
        continue;
      }

      const tool = this.registry.getTool(toolName);
      const inputSchema = tool?.manifest?.input_schema;
      if (!inputSchema) {
        continue;
      }

      try {
        const validator = this.getToolArgsValidator(toolName, inputSchema as AnySchema);
        const valid = validator(step.args);
        if (!valid) {
          for (const validationError of validator.errors ?? []) {
            const formattedPath = this.formatValidationErrorPath(validationError);
            errors.push({
              code: DeterministicRuntimeErrorCodes.ERR_TOOL_ARGS_INVALID,
              message: `tool args invalid for step '${step.id}': ${validationError.message ?? 'schema validation failed'}`,
              path: formattedPath === '/'
                ? `/steps/${step.id}/args`
                : `/steps/${step.id}/args${formattedPath}`,
              stepId: step.id,
            });
          }
        }
      } catch (error) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_TOOL_ARGS_INVALID,
          message: `tool args validation unavailable for step '${step.id}': ${(error as Error).message}`,
          path: `/steps/${step.id}/args`,
          stepId: step.id,
        });
      }
    }

    return errors;
  }

  private resolveToolName(toolRef?: string): string | null {
    if (!toolRef) {
      return null;
    }

    if (toolRef.startsWith('local://')) {
      return toolRef.slice('local://'.length);
    }

    if (toolRef.startsWith('skills://')) {
      return toolRef.slice('skills://'.length);
    }

    if (toolRef.startsWith('mcp://')) {
      const mcpPath = toolRef.slice('mcp://'.length);
      const slashIdx = mcpPath.indexOf('/');
      if (slashIdx > 0 && slashIdx < mcpPath.length - 1) {
        const server = mcpPath.slice(0, slashIdx);
        const tool = mcpPath.slice(slashIdx + 1);
        return `mcp__${server}__${tool}`;
      }
      return null;
    }

    if (toolRef.startsWith('script://')) {
      return toolRef.slice('script://'.length);
    }

    return null;
  }

  private getToolArgsValidator(toolName: string, schema: AnySchema): ValidateFunction {
    const cachedValidator = this.toolArgsValidators.get(toolName);
    if (cachedValidator) {
      return cachedValidator;
    }

    const compiled = this.toolArgsAjv.compile(schema);
    this.toolArgsValidators.set(toolName, compiled);
    return compiled;
  }

  private formatValidationErrorPath(error: ErrorObject): string {
    const instancePath = error.instancePath ?? '';
    const params = error.params as { additionalProperty?: string; missingProperty?: string };

    if (error.keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
      return instancePath ? `${instancePath}/${params.additionalProperty}` : `/${params.additionalProperty}`;
    }

    if (error.keyword === 'required' && typeof params.missingProperty === 'string') {
      return instancePath ? `${instancePath}/${params.missingProperty}` : `/${params.missingProperty}`;
    }

    return instancePath || '/';
  }

  private validatePolicy(plan: PlanV1, runtimeProfile?: unknown): CompileError[] {
    const profile = this.toRuntimePolicyProfile(runtimeProfile);
    if (!profile) {
      return this.validateRiskyToolApprovalPolicy(plan);
    }

    const errors: CompileError[] = [];
    errors.push(...this.validateToolRoutingPolicy(plan, profile));
    errors.push(...this.validateToolAllowDenyPolicy(plan, profile));
    errors.push(...this.validateDefaultNetworkPolicy(plan, profile));
    errors.push(...this.validateFilesystemScopePolicy(plan, profile));
    errors.push(...this.validateHumanApprovalPolicy(plan, profile));
    errors.push(...this.validateRiskyToolApprovalPolicy(plan));
    errors.push(...this.validateScriptSandboxPolicy(plan, profile));
    return errors;
  }

  private toRuntimePolicyProfile(runtimeProfile?: unknown): RuntimePolicyProfile | null {
    if (!runtimeProfile || typeof runtimeProfile !== 'object' || Array.isArray(runtimeProfile)) {
      return null;
    }

    return runtimeProfile as RuntimePolicyProfile;
  }

  private validateHumanApprovalPolicy(plan: PlanV1, profile: RuntimePolicyProfile): CompileError[] {
    const requiresApproval = new Set(profile.policy?.require_human_approval_for ?? []);
    if (requiresApproval.size === 0) {
      return [];
    }

    const stepById = new Map(plan.steps.map((step) => [step.id, step]));
    const errors: CompileError[] = [];

    for (const step of plan.steps) {
      if (!requiresApproval.has(step.type)) {
        continue;
      }

      const dependsOn = step.depends_on ?? [];
      const hasHumanApprovalDependency = dependsOn.some((depId) => stepById.get(depId)?.type === 'human_confirm');
      if (!hasHumanApprovalDependency) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_POLICY_REQUIRE_HUMAN_APPROVAL,
          message: `step '${step.id}' requires human_confirm dependency by policy`,
          path: '/steps',
          stepId: step.id,
        });
      }
    }

    return errors;
  }

  private normalizeToolPolicyEntry(entry: string): string {
    const trimmed = entry.trim();
    if (trimmed.startsWith('local://')) {
      return trimmed.slice('local://'.length);
    }

    return trimmed;
  }

  private validateToolAllowDenyPolicy(plan: PlanV1, profile: RuntimePolicyProfile): CompileError[] {
    const allowEntries = (profile.policy?.tool_allowlist ?? []).map((entry) => this.normalizeToolPolicyEntry(entry));
    const denyEntries = (profile.policy?.tool_denylist ?? []).map((entry) => this.normalizeToolPolicyEntry(entry));
    const allowSet = new Set(allowEntries);
    const denySet = new Set(denyEntries);

    if (allowSet.size === 0 && denySet.size === 0) {
      return [];
    }

    const errors: CompileError[] = [];
    for (const step of plan.steps) {
      if (step.type !== 'tool_call') {
        continue;
      }

      const resolvedToolName = this.resolveToolName(step.tool_ref);
      const rawToolRef = step.tool_ref?.trim();
      const normalizedRawToolRef = rawToolRef ? this.normalizeToolPolicyEntry(rawToolRef) : undefined;
      const candidates = new Set<string>();
      if (resolvedToolName) {
        candidates.add(resolvedToolName);
      }
      if (normalizedRawToolRef) {
        candidates.add(normalizedRawToolRef);
      }

      if (denySet.size > 0 && [...candidates].some((candidate) => denySet.has(candidate))) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
          message: `tool_call step '${step.id}' uses denied tool '${step.tool_ref ?? resolvedToolName ?? 'unknown'}'`,
          path: '/steps',
          stepId: step.id,
        });
        continue;
      }

      if (allowSet.size > 0 && ![...candidates].some((candidate) => allowSet.has(candidate))) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
          message: `tool_call step '${step.id}' tool '${step.tool_ref ?? resolvedToolName ?? 'unknown'}' is not in policy allowlist`,
          path: '/steps',
          stepId: step.id,
        });
      }
    }

    return errors;
  }

  private validateDefaultNetworkPolicy(plan: PlanV1, profile: RuntimePolicyProfile): CompileError[] {
    if (profile.policy?.default_network !== 'deny') {
      return [];
    }

    const errors: CompileError[] = [];
    for (const step of plan.steps) {
      if (step.type !== 'tool_call') {
        continue;
      }

      const toolName = this.resolveToolName(step.tool_ref);
      if (!toolName) {
        continue;
      }

      const tool = this.registry.getTool(toolName);
      if (!tool) {
        continue;
      }

      const networkPermission = tool.manifest?.permissions?.network;
      const usesNetwork = networkPermission === 'allow' || tool.category === 'network';
      if (usesNetwork) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
          message: `tool_call step '${step.id}' requests network-capable tool '${step.tool_ref ?? toolName}' while default_network=deny`,
          path: `/steps/${step.id}/tool_ref`,
          stepId: step.id,
        });
      }
    }

    return errors;
  }

  private validateRiskyToolApprovalPolicy(plan: PlanV1): CompileError[] {
    const stepById = new Map(plan.steps.map((step) => [step.id, step]));
    const errors: CompileError[] = [];

    for (const step of plan.steps) {
      if (step.type !== 'tool_call') {
        continue;
      }

      const toolName = this.resolveToolName(step.tool_ref);
      if (!toolName) {
        continue;
      }

      const tool = this.registry.getTool(toolName);
      if (!tool) {
        continue;
      }

      const sideEffect = tool.manifest?.side_effect;
      const requiresHumanApproval = tool.requiresApproval
        || sideEffect === 'non_idempotent'
        || sideEffect === 'ui_automation';

      if (!requiresHumanApproval) {
        continue;
      }

      const hasHumanApprovalDependency = (step.depends_on ?? [])
        .some((depId) => stepById.get(depId)?.type === 'human_confirm');
      if (!hasHumanApprovalDependency) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_POLICY_REQUIRE_HUMAN_APPROVAL,
          message: `tool_call step '${step.id}' uses high-risk tool '${step.tool_ref ?? toolName}' and must depend on human_confirm`,
          path: '/steps',
          stepId: step.id,
        });
      }
    }

    return errors;
  }

  private validateToolRoutingPolicy(plan: PlanV1, profile: RuntimePolicyProfile): CompileError[] {
    const planToolRouting = (plan as { tool_routing?: RuntimePolicyProfile['tool_routing'] }).tool_routing;
    const runtimeToolRouting = profile.tool_routing;
    if (!planToolRouting || !runtimeToolRouting) {
      return [];
    }

    const errors: CompileError[] = [];
    const runtimeAllowModelTools = runtimeToolRouting.allow_model_native_tools === true;
    const planAllowModelTools = planToolRouting.allow_model_native_tools === true;
    if (planAllowModelTools && !runtimeAllowModelTools) {
      errors.push({
        code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
        message: 'plan tool_routing.allow_model_native_tools cannot enable model-native tools beyond runtime profile policy',
        path: '/tool_routing/allow_model_native_tools',
      });
    }

    const modeRank: Record<'legacy' | 'system_only' | 'system_preferred' | 'model_preferred', number> = {
      legacy: 0,
      system_only: 1,
      system_preferred: 2,
      model_preferred: 3,
    };
    const runtimeMode = runtimeToolRouting.mode ?? 'legacy';
    const planMode = planToolRouting.mode ?? runtimeMode;
    if (modeRank[planMode] > modeRank[runtimeMode]) {
      errors.push({
        code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
        message: `plan tool_routing.mode '${planMode}' is less restrictive than runtime profile mode '${runtimeMode}'`,
        path: '/tool_routing/mode',
      });
    }

    const runtimeResolutionOrder = new Set(runtimeToolRouting.resolution_order ?? []);
    const planResolutionOrder = planToolRouting.resolution_order ?? [];
    for (let index = 0; index < planResolutionOrder.length; index += 1) {
      const entry = planResolutionOrder[index];
      if (!runtimeResolutionOrder.has(entry)) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
          message: `plan tool_routing.resolution_order entry '${entry}' is not allowed by runtime profile`,
          path: `/tool_routing/resolution_order/${index}`,
        });
      }
    }

    return errors;
  }

  private normalizePolicyPath(pathValue: string): string {
    const trimmed = pathValue.trim();
    if (trimmed === '*') {
      return '*';
    }

    if (trimmed.length > 1 && trimmed.endsWith('/')) {
      return trimmed.slice(0, -1);
    }

    return trimmed;
  }

  private isPathWithinScopes(pathValue: string, scopes: string[]): boolean {
    const normalizedPath = this.normalizePolicyPath(pathValue);
    const normalizedScopes = scopes.map((scope) => this.normalizePolicyPath(scope));

    if (normalizedScopes.includes('*')) {
      return true;
    }

    return normalizedScopes.some((scope) => (
      normalizedPath === scope || normalizedPath.startsWith(`${scope}/`)
    ));
  }

  private validateFilesystemScopePolicy(plan: PlanV1, profile: RuntimePolicyProfile): CompileError[] {
    const scope = profile.policy?.default_filesystem_scope;
    const allowedReadScopes = scope?.read ?? [];
    const allowedWriteScopes = scope?.write ?? [];
    const errors: CompileError[] = [];

    for (const step of plan.steps) {
      if (step.type === 'tool_call') {
        const toolName = this.resolveToolName(step.tool_ref);
        const tool = toolName ? this.registry.getTool(toolName) : undefined;
        const declaredReads = step.reads ?? [];
        const declaredWrites = step.writes ?? [];
        const requiresReadScope = (tool?.manifest?.permissions?.filesystem?.read?.length ?? 0) > 0;
        const requiresWriteScope = (tool?.manifest?.permissions?.filesystem?.write?.length ?? 0) > 0;

        if (requiresReadScope && declaredReads.length === 0) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
            message: `tool_call step '${step.id}' must declare reads[] for filesystem policy evaluation`,
            path: `/steps/${step.id}/reads`,
            stepId: step.id,
          });
        }

        if (requiresWriteScope && declaredWrites.length === 0) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
            message: `tool_call step '${step.id}' must declare writes[] for filesystem policy evaluation`,
            path: `/steps/${step.id}/writes`,
            stepId: step.id,
          });
        }
      }

      const requestedReads = step.reads ?? [];
      for (let index = 0; index < requestedReads.length; index += 1) {
        const readPath = requestedReads[index];
        if (!this.isPathWithinScopes(readPath, allowedReadScopes)) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
            message: `step '${step.id}' read path '${readPath}' is outside policy default_filesystem_scope.read`,
            path: `/steps/${step.id}/reads/${index}`,
            stepId: step.id,
          });
        }
      }

      const requestedWrites = step.writes ?? [];
      for (let index = 0; index < requestedWrites.length; index += 1) {
        const writePath = requestedWrites[index];
        if (!this.isPathWithinScopes(writePath, allowedWriteScopes)) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED,
            message: `step '${step.id}' write path '${writePath}' is outside policy default_filesystem_scope.write`,
            path: `/steps/${step.id}/writes/${index}`,
            stepId: step.id,
          });
        }
      }
    }

    return errors;
  }

  private validateScriptSandboxPolicy(plan: PlanV1, profile: RuntimePolicyProfile): CompileError[] {
    const sandbox = profile.policy?.script_sandbox;
    const scriptSteps = plan.steps.filter((step) => step.type === 'script_generate' || step.type === 'script_execute');
    if (scriptSteps.length === 0) {
      return [];
    }

    if (!sandbox) {
      return scriptSteps.map((step) => ({
        code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
        message: `script step '${step.id}' is denied because script_sandbox policy is missing`,
        path: '/steps',
        stepId: step.id,
      }));
    }

    const allowedLanguages = new Set(sandbox.allowed_languages ?? []);
    const allowedApps = new Set(sandbox.allowed_apps ?? []);
    const maxRuntime = sandbox.max_runtime_ms;
    const maxOutputBytes = sandbox.max_output_bytes;
    const noNetwork = sandbox.no_network === true;
    const errors: CompileError[] = [];

    for (const step of scriptSteps) {
      const language = typeof step.language === 'string'
        ? step.language
        : (typeof step.args?.language === 'string' ? step.args.language : undefined);
      if (allowedLanguages.size > 0 && (!language || !allowedLanguages.has(language))) {
        errors.push({
          code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
          message: `script step '${step.id}' language '${language ?? 'undefined'}' is not allowed`,
          path: '/steps',
          stepId: step.id,
        });
      }

      if (noNetwork) {
        const requestedNetwork = typeof step.args?.network === 'string' ? step.args.network : undefined;
        const requiresNetwork = step.args?.requires_network === true || requestedNetwork === 'allow';
        if (requiresNetwork) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
            message: `script step '${step.id}' requests network access but policy enforces no_network`,
            path: '/steps',
            stepId: step.id,
          });
        }
      }

      if (allowedApps.size > 0) {
        const requestedApp = typeof step.args?.app === 'string' ? step.args.app : undefined;
        if (requestedApp && !allowedApps.has(requestedApp)) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
            message: `script step '${step.id}' app '${requestedApp}' is not allowed`,
            path: '/steps',
            stepId: step.id,
          });
        }

        const requestedApps = Array.isArray(step.args?.allowed_apps)
          ? step.args.allowed_apps.filter((value): value is string => typeof value === 'string')
          : [];
        for (const appName of requestedApps) {
          if (!allowedApps.has(appName)) {
            errors.push({
              code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
              message: `script step '${step.id}' app '${appName}' is not allowed`,
              path: '/steps',
              stepId: step.id,
            });
          }
        }
      }

      if (step.type === 'script_execute') {
        const requestedRuntime = typeof step.timeout_ms === 'number'
          ? step.timeout_ms
          : (typeof step.args?.runtime_ms === 'number' ? step.args.runtime_ms : undefined);
        if (typeof maxRuntime === 'number' && typeof requestedRuntime === 'number' && requestedRuntime > maxRuntime) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
            message: `script step '${step.id}' runtime_ms ${requestedRuntime} exceeds policy max ${maxRuntime}`,
            path: '/steps',
            stepId: step.id,
          });
        }

        const requestedOutput = typeof step.args?.max_output_bytes === 'number'
          ? step.args.max_output_bytes
          : undefined;
        if (
          typeof maxOutputBytes === 'number'
          && typeof requestedOutput === 'number'
          && requestedOutput > maxOutputBytes
        ) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED,
            message: `script step '${step.id}' max_output_bytes ${requestedOutput} exceeds policy max ${maxOutputBytes}`,
            path: '/steps',
            stepId: step.id,
          });
        }
      }
    }

    return errors;
  }

  private sortErrors(errors: CompileError[]): CompileError[] {
    return [...errors].sort((a, b) => {
      const byCode = a.code.localeCompare(b.code);
      if (byCode !== 0) {
        return byCode;
      }

      const aStep = a.stepId ?? '';
      const bStep = b.stepId ?? '';
      const byStep = aStep.localeCompare(bStep);
      if (byStep !== 0) {
        return byStep;
      }

      const byPath = a.path.localeCompare(b.path);
      if (byPath !== 0) {
        return byPath;
      }

      return a.message.localeCompare(b.message);
    });
  }
}
