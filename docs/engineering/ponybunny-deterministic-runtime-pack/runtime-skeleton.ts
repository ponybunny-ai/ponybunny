/* PonyBunny Deterministic Runtime v1 (skeleton)
 * - Plan-only LLM output (no native tools)
 * - Compile/verify plan deterministically
 * - Execute via system Tool Registry (skills/mcp/local/script)
 * - Event-sourcing log + replay
 */

import crypto from "node:crypto";
import { spawn } from "node:child_process";

export type ToolNamespace = "skills" | "mcp" | "local" | "script";
export type ToolRef = `${ToolNamespace}://${string}`;

export type SideEffect = "none" | "idempotent" | "non_idempotent" | "ui_automation";

export interface ToolManifest {
  tool_ref: ToolRef;
  display_name: string;
  description?: string;
  version?: string;
  tags?: string[];
  input_schema: unknown;   // JSON Schema
  output_schema: unknown;  // JSON Schema
  side_effect: SideEffect;
  supports_idempotency_key?: boolean;
  default_timeout_ms?: number;
  permissions: {
    network?: "deny" | "allow";
    filesystem?: { read?: string[]; write?: string[] };
    apps?: string[];
  };
}

export interface RuntimeProfile {
  profile_id: string;
  display_name?: string;
  tool_routing: {
    mode: "system_only" | "system_preferred" | "model_preferred";
    allow_model_native_tools: boolean;
    resolution_order: Array<"skills" | "mcp" | "local_tools" | "sandbox_scripts">;
  };
  policy: {
    default_network: "deny" | "allow";
    default_filesystem_scope: { read?: string[]; write?: string[] };
    tool_allowlist?: string[];
    tool_denylist?: string[];
    require_human_approval_for?: string[];
    script_sandbox?: {
      allowed_languages?: Array<"applescript" | "bash">;
      no_network?: boolean;
      allowed_apps?: string[];
      max_runtime_ms?: number;
      max_output_bytes?: number;
    };
  };
}

export type StepType = "tool_call" | "transform" | "human_confirm" | "script_generate" | "script_execute";

export interface PlanV1 {
  schema_version: "plan.v1";
  plan_id: string;
  goal: string;
  tool_routing?: {
    mode?: "system_only" | "system_preferred" | "model_preferred";
    allow_model_native_tools?: boolean;
    resolution_order?: Array<"skills" | "mcp" | "local_tools" | "sandbox_scripts">;
  };
  variables?: Record<string, unknown>;
  steps: Step[];
}

export interface Step {
  id: string;
  type: StepType;
  title?: string;
  depends_on?: string[];
  reads?: string[];
  writes?: string[];
  retry_policy?: { max_attempts?: number; backoff_ms?: number };
  timeout_ms?: number;
  idempotency_key?: string;

  tool_ref?: ToolRef;
  args?: Record<string, unknown>;

  message?: string;

  language?: "applescript" | "bash";
  goal?: string;
  constraints?: Record<string, unknown>;

  script_ref?: string;

  capture?: { stdout?: boolean; stderr?: boolean };
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "paused_for_human";

export type RunEventType =
  | "PLAN_ACCEPTED"
  | "RUN_STARTED"
  | "STEP_STARTED"
  | "HUMAN_CONFIRM_REQUESTED"
  | "HUMAN_CONFIRM_RECEIVED"
  | "TOOL_REQUESTED"
  | "TOOL_RESPONDED"
  | "ARTIFACT_WRITTEN"
  | "STEP_SUCCEEDED"
  | "STEP_FAILED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED";

export interface RunEvent {
  run_id: string;
  seq: number;
  ts: string;
  type: RunEventType;
  payload: any;
}

export interface CompileError {
  code: string;
  message: string;
  step_id?: string;
  details?: any;
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

export class ToolRegistry {
  private manifests = new Map<ToolRef, ToolManifest>();
  private handlers = new Map<ToolRef, (args: any, ctx: ExecContext) => Promise<any>>();

  register(manifest: ToolManifest, handler: (args: any, ctx: ExecContext) => Promise<any>) {
    this.manifests.set(manifest.tool_ref, manifest);
    this.handlers.set(manifest.tool_ref, handler);
  }

  getManifest(ref: ToolRef) { return this.manifests.get(ref); }
  getHandler(ref: ToolRef) { return this.handlers.get(ref); }
  has(ref: ToolRef) { return this.manifests.has(ref) && this.handlers.has(ref); }
  list() { return [...this.manifests.values()]; }
}

export interface ExecContext {
  session_id: string;
  run_id: string;
  plan: PlanV1;
  profile: RuntimeProfile;
  registry: ToolRegistry;

  vars: Record<string, any>;
  artifacts: Record<string, any>;

  emit: (type: RunEventType, payload: any) => Promise<void>;
  nowISO: () => string;
}

export class PlanCompiler {
  constructor(private registry: ToolRegistry) {}

  compile(plan: PlanV1, profile: RuntimeProfile): { ok: true; orderedSteps: Step[] } | { ok: false; errors: CompileError[] } {
    const errors: CompileError[] = [];

    // Unique step ids
    const stepIds = new Set<string>();
    for (const s of plan.steps) {
      if (stepIds.has(s.id)) errors.push({ code: "ERR_STEP_ID_DUP", message: `Duplicate step id: ${s.id}`, step_id: s.id });
      stepIds.add(s.id);
    }

    // Build dependency graph for topo sort
    const graph = new Map<string, string[]>();
    const indeg = new Map<string, number>();
    for (const s of plan.steps) {
      graph.set(s.id, (s.depends_on ?? []).slice());
      indeg.set(s.id, 0);
    }
    for (const s of plan.steps) {
      for (const dep of (s.depends_on ?? [])) {
        if (!stepIds.has(dep)) {
          errors.push({ code: "ERR_STEP_DEP_MISSING", message: `Step ${s.id} depends on missing step: ${dep}`, step_id: s.id, details: { dep } });
          continue;
        }
        indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1);
      }
    }

    // Kahn topo with stable ordering (lexicographic)
    const queue: string[] = [...stepIds].filter(id => (indeg.get(id) ?? 0) === 0).sort();
    const orderedIds: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      orderedIds.push(id);
      for (const [node, deps] of graph.entries()) {
        if (deps.includes(id)) {
          indeg.set(node, (indeg.get(node) ?? 0) - 1);
          if ((indeg.get(node) ?? 0) === 0) {
            queue.push(node);
            queue.sort();
          }
        }
      }
    }
    if (orderedIds.length !== stepIds.size) errors.push({ code: "ERR_STEP_DEPENDENCY_CYCLE", message: "Dependency cycle detected" });

    // Tool existence + basic policy checks (args schema validation is stubbed)
    for (const s of plan.steps) {
      if (s.type === "tool_call") {
        if (!s.tool_ref) errors.push({ code: "ERR_TOOL_REF_MISSING", message: "tool_ref is required for tool_call", step_id: s.id });
        else if (!this.registry.has(s.tool_ref)) errors.push({ code: "ERR_TOOL_NOT_FOUND", message: `Tool not found: ${s.tool_ref}`, step_id: s.id });
        else {
          const m = this.registry.getManifest(s.tool_ref)!;

          const deny = profile.policy.tool_denylist?.includes(m.tool_ref);
          const allow = profile.policy.tool_allowlist ? profile.policy.tool_allowlist.includes(m.tool_ref) : true;
          if (deny || !allow) errors.push({ code: "ERR_POLICY_TOOL_DENY", message: `Tool denied by policy: ${m.tool_ref}`, step_id: s.id });

          if (m.side_effect === "ui_automation" || m.side_effect === "non_idempotent") {
            const requireList = profile.policy.require_human_approval_for ?? [];
            const needsConfirm = requireList.includes("local_tools:ui_automation") || requireList.includes("sandbox_scripts") || m.side_effect === "ui_automation";
            if (needsConfirm) {
              const hasAnyConfirm = plan.steps.some(x => x.type === "human_confirm");
              if (!hasAnyConfirm) errors.push({ code: "ERR_POLICY_REQUIRE_HUMAN_APPROVAL", message: `High-risk step requires human_confirm`, step_id: s.id, details: { side_effect: m.side_effect } });
            }
          }
        }
      }

      if (s.type === "script_execute") {
        const requireList = profile.policy.require_human_approval_for ?? [];
        if (requireList.includes("sandbox_scripts")) {
          const hasAnyConfirm = plan.steps.some(x => x.type === "human_confirm");
          if (!hasAnyConfirm) errors.push({ code: "ERR_POLICY_REQUIRE_HUMAN_APPROVAL", message: "script_execute requires human_confirm per policy", step_id: s.id });
        }
      }
    }

    if (errors.length) return { ok: false, errors };

    const stepMap = new Map(plan.steps.map(s => [s.id, s]));
    const orderedSteps = orderedIds.map(id => stepMap.get(id)!).filter(Boolean);
    return { ok: true, orderedSteps };
  }
}

export class RuntimeExecutor {
  constructor(private registry: ToolRegistry) {}

  async execute(plan: PlanV1, profile: RuntimeProfile, ctxBase: Omit<ExecContext, "plan" | "profile" | "registry" | "vars" | "artifacts">) {
    const compiler = new PlanCompiler(this.registry);
    const compiled = compiler.compile(plan, profile);
    if (!compiled.ok) {
      await ctxBase.emit("RUN_FAILED", { code: "ERR_PLAN_COMPILE_FAILED", errors: compiled.errors });
      throw new Error("Plan compile failed");
    }

    const ctx: ExecContext = {
      ...ctxBase,
      plan,
      profile,
      registry: this.registry,
      vars: { ...(plan.variables ?? {}) },
      artifacts: {}
    };

    await ctx.emit("PLAN_ACCEPTED", { plan_id: plan.plan_id, schema_version: plan.schema_version });
    await ctx.emit("RUN_STARTED", { goal: plan.goal });

    for (const step of compiled.orderedSteps) {
      await ctx.emit("STEP_STARTED", { step_id: step.id, type: step.type });

      const argsHash = sha256Hex(stableStringify(step.args ?? {}));
      const toolRef = step.tool_ref ?? "";
      const idem = step.idempotency_key ?? sha256Hex(`${ctx.session_id}|${ctx.run_id}|${plan.plan_id}|${step.id}|${toolRef}|${argsHash}`);
      step.idempotency_key = idem;

      try {
        if (step.type === "human_confirm") {
          await ctx.emit("HUMAN_CONFIRM_REQUESTED", { step_id: step.id, message: step.message });
          // Skeleton: auto-approve (replace with real pause/resume)
          await ctx.emit("HUMAN_CONFIRM_RECEIVED", { step_id: step.id, approved: true });
          await ctx.emit("STEP_SUCCEEDED", { step_id: step.id });
          continue;
        }

        if (step.type === "tool_call") {
          const handler = this.registry.getHandler(step.tool_ref!);
          if (!handler) throw new Error(`Tool handler missing: ${step.tool_ref}`);

          await ctx.emit("TOOL_REQUESTED", { step_id: step.id, tool_ref: step.tool_ref, idempotency_key: idem, args: step.args });
          const result = await handler({ ...(step.args ?? {}), idempotency_key: idem }, ctx);
          await ctx.emit("TOOL_RESPONDED", { step_id: step.id, tool_ref: step.tool_ref, result });
          await ctx.emit("STEP_SUCCEEDED", { step_id: step.id });
          continue;
        }

        if (step.type === "script_generate") {
          const script = `-- generated script placeholder for goal: ${step.goal ?? ""}\n`;
          const artifactKey = `artifact://scripts/${step.id}.${step.language ?? "txt"}`;
          ctx.artifacts[artifactKey] = script;
          await ctx.emit("ARTIFACT_WRITTEN", { step_id: step.id, ref: artifactKey, sha256: sha256Hex(script) });
          await ctx.emit("STEP_SUCCEEDED", { step_id: step.id });
          continue;
        }

        if (step.type === "script_execute") {
          const ref = step.script_ref!;
          const script = ctx.artifacts[ref] ?? "";
          await ctx.emit("TOOL_REQUESTED", { step_id: step.id, tool_ref: "local://osascript.run", idempotency_key: idem, args: { script_ref: ref } });

          const { stdout, stderr, exitCode } = await runOsascript(String(script), step.timeout_ms ?? 5000);

          await ctx.emit("TOOL_RESPONDED", { step_id: step.id, tool_ref: "local://osascript.run", result: { stdout, stderr, exitCode } });
          if (exitCode !== 0) throw new Error(`osascript failed: ${stderr}`);
          await ctx.emit("STEP_SUCCEEDED", { step_id: step.id });
          continue;
        }

        await ctx.emit("STEP_SUCCEEDED", { step_id: step.id, note: "transform not implemented in skeleton" });
      } catch (err: any) {
        await ctx.emit("STEP_FAILED", { step_id: step.id, error: { message: String(err?.message ?? err), stack: err?.stack }, idempotency_key: idem });
        await ctx.emit("RUN_FAILED", { step_id: step.id, error: String(err?.message ?? err) });
        throw err;
      }
    }

    await ctx.emit("RUN_SUCCEEDED", { plan_id: plan.plan_id });
  }
}

async function runOsascript(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const p = spawn("osascript", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, Math.max(0, timeoutMs));

    p.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    p.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    p.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 1 }); });

    p.stdin.write(script);
    p.stdin.end();
  });
}

export class InMemoryEventLog {
  private seq = 0;
  public events: RunEvent[] = [];

  async emit(run_id: string, type: RunEventType, payload: any) {
    this.seq += 1;
    this.events.push({ run_id, seq: this.seq, ts: new Date().toISOString(), type, payload });
  }
}
