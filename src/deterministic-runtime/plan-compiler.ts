import type { ToolRegistry } from '../infra/tools/tool-registry.js';
import { DeterministicRuntimeErrorCodes, type DeterministicRuntimeErrorCode } from './error-codes.js';
import { DeterministicSchemaValidator } from './schema-validator.js';

export interface PlanStepV1 {
  id: string;
  type: 'tool_call' | 'transform' | 'human_confirm' | 'script_generate' | 'script_execute';
  depends_on?: string[];
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
  policy?: {
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
    const stepIds = new Set(plan.steps.map((step) => step.id));

    for (const step of plan.steps) {
      for (const depId of step.depends_on ?? []) {
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
      const requiredArgs = tool?.manifest?.input_schema.required ?? [];
      for (const requiredArg of requiredArgs) {
        if (!(requiredArg in step.args)) {
          errors.push({
            code: DeterministicRuntimeErrorCodes.ERR_TOOL_ARGS_INVALID,
            message: `missing required arg '${requiredArg}' for step '${step.id}'`,
            path: '/steps',
            stepId: step.id,
          });
        }
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

  private validatePolicy(plan: PlanV1, runtimeProfile?: unknown): CompileError[] {
    const profile = this.toRuntimePolicyProfile(runtimeProfile);
    if (!profile?.policy) {
      return [];
    }

    const errors: CompileError[] = [];
    errors.push(...this.validateHumanApprovalPolicy(plan, profile));
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
