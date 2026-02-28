import { ToolRegistry } from '../../src/infra/tools/tool-registry.js';
import { ReadFileTool } from '../../src/infra/tools/implementations/read-file-tool.js';
import { WriteFileTool } from '../../src/infra/tools/implementations/write-file-tool.js';
import { WebSearchTool } from '../../src/infra/tools/implementations/web-search-tool.js';
import { ExecuteCommandTool } from '../../src/infra/tools/implementations/execute-command-tool.js';
import { PlanCompiler } from '../../src/deterministic-runtime/plan-compiler.js';
import { DeterministicRuntimeErrorCodes } from '../../src/deterministic-runtime/error-codes.js';

describe('PlanCompiler', () => {
  function createCompiler(): PlanCompiler {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new WriteFileTool());
    registry.register(new WebSearchTool());
    registry.register(new ExecuteCommandTool());
    return new PlanCompiler(registry);
  }

  it('returns accepted plan for valid plan input', () => {
    const compiler = createCompiler();

    const result = compiler.compile({
      schema_version: 'plan.v1',
      plan_id: 'plan-valid-0001',
      goal: 'Compile deterministic plan',
      steps: [
        {
          id: 'read_step',
          type: 'tool_call',
          tool_ref: 'local://read_file',
          args: { path: '/tmp/a.txt' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.acceptedPlan?.schemaVersion).toBe('plan.v1');
    expect(result.acceptedPlan?.planId).toBe('plan-valid-0001');
    expect(result.acceptedPlan?.steps).toHaveLength(1);
  });

  it('fails fast on schema errors before semantic checks', () => {
    const compiler = createCompiler();

    const result = compiler.compile({
      schema_version: 'plan.v1',
      plan_id: 'short',
      steps: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.code === DeterministicRuntimeErrorCodes.ERR_PLAN_SCHEMA_INVALID)).toBe(true);
  });

  it('reports dependency, cycle, tool and args errors in stable deterministic order', () => {
    const compiler = createCompiler();

    const invalidPlan = {
      schema_version: 'plan.v1',
      plan_id: 'plan-invalid-1000',
      goal: 'Trigger compiler validation errors',
      steps: [
        {
          id: 'a',
          type: 'tool_call',
          depends_on: ['missingstep', 'b'],
          tool_ref: 'local://missing_tool',
          args: {},
        },
        {
          id: 'b',
          type: 'tool_call',
          depends_on: ['a'],
          tool_ref: 'local://read_file',
          args: {},
        },
      ],
    };

    const first = compiler.compile(invalidPlan);
    const second = compiler.compile(invalidPlan);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(first.errors).toEqual(second.errors);

    expect(first.errors.some((e) => e.code === DeterministicRuntimeErrorCodes.ERR_STEP_DEPENDENCY_INVALID)).toBe(true);
    expect(first.errors.some((e) => e.code === DeterministicRuntimeErrorCodes.ERR_STEP_CYCLE_DETECTED)).toBe(true);
    expect(first.errors.some((e) => e.code === DeterministicRuntimeErrorCodes.ERR_TOOL_NOT_FOUND)).toBe(true);
    expect(first.errors.some((e) => e.code === DeterministicRuntimeErrorCodes.ERR_TOOL_ARGS_INVALID)).toBe(true);
  });

  it('rejects duplicate step ids and self dependencies', () => {
    const compiler = createCompiler();

    const result = compiler.compile({
      schema_version: 'plan.v1',
      plan_id: 'plan-duplicate-step-0001',
      goal: 'Detect duplicate ids and self dependency',
      steps: [
        {
          id: 'dup_step',
          type: 'tool_call',
          tool_ref: 'local://read_file',
          args: { path: '/tmp/a.txt' },
        },
        {
          id: 'dup_step',
          type: 'tool_call',
          tool_ref: 'local://read_file',
          args: { path: '/tmp/b.txt' },
          depends_on: ['dup_step'],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_STEP_ID_DUPLICATE)).toBe(true);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_STEP_DEPENDENCY_INVALID
      && error.message.includes('cannot depend on itself')
    )).toBe(true);
  });

  it('validates tool args against full input schema (not only required fields)', () => {
    const compiler = createCompiler();

    const result = compiler.compile({
      schema_version: 'plan.v1',
      plan_id: 'plan-tool-args-schema-0001',
      goal: 'Validate tool args schema',
      steps: [
        {
          id: 'read_step',
          type: 'tool_call',
          tool_ref: 'local://read_file',
          args: { path: 42 },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_TOOL_ARGS_INVALID
      && error.path.includes('/steps/read_step/args/path')
    )).toBe(true);
  });

  it('fails compile when runtimeProfile schema is invalid', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-runtime-profile-invalid-0001',
        goal: 'Invalid runtime profile compile',
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/a.txt' },
          },
        ],
      },
      {
        profile_id: 'broken-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills'],
        },
        policy: {
          default_filesystem_scope: {
            read: ['/tmp'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED)).toBe(true);
    expect(result.errors.some((error) => error.path.includes('/policy/default_network'))).toBe(true);
  });

  it('enforces human approval policy for configured step types', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-human-0001',
        goal: 'Require human approval for scripts',
        steps: [
          {
            id: 'script_step',
            type: 'script_execute',
            script_ref: 'script-1',
            language: 'bash',
          },
        ],
      },
      {
        profile_id: 'policy-human-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          require_human_approval_for: ['script_execute'],
          script_sandbox: {
            allowed_languages: ['bash'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_REQUIRE_HUMAN_APPROVAL)).toBe(true);
  });

  it('enforces script sandbox language and runtime limits', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-sandbox-0001',
        goal: 'Validate script sandbox policy',
        steps: [
          {
            id: 'script_step',
            type: 'script_execute',
            script_ref: 'script-2',
            language: 'bash',
            timeout_ms: 30000,
            args: { max_output_bytes: 8192 },
          },
        ],
      },
      {
        profile_id: 'policy-sandbox-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          script_sandbox: {
            allowed_languages: ['applescript'],
            max_runtime_ms: 5000,
            max_output_bytes: 4096,
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.filter((error) => error.code === DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED).length).toBeGreaterThanOrEqual(2);
  });

  it('accepts script step when policy allows language and limits', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-pass-0001',
        goal: 'Allowed script step',
        steps: [
          {
            id: 'approval',
            type: 'human_confirm',
            message: 'Approve script execution',
          },
          {
            id: 'script_step',
            type: 'script_execute',
            depends_on: ['approval'],
            script_ref: 'script-3',
            language: 'bash',
            timeout_ms: 3000,
            args: { max_output_bytes: 2048 },
          },
        ],
      },
      {
        profile_id: 'policy-pass-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          require_human_approval_for: ['script_execute'],
          script_sandbox: {
            allowed_languages: ['bash'],
            max_runtime_ms: 5000,
            max_output_bytes: 4096,
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('denies script network access when no_network policy is enabled', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-network-0001',
        goal: 'No network policy',
        steps: [
          {
            id: 'script_step',
            type: 'script_execute',
            script_ref: 'script-4',
            language: 'bash',
            args: {
              requires_network: true,
            },
          },
        ],
      },
      {
        profile_id: 'policy-network-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          script_sandbox: {
            allowed_languages: ['bash'],
            no_network: true,
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED)).toBe(true);
  });

  it('denies script apps outside allowed_apps policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-apps-0001',
        goal: 'Allowed apps policy',
        steps: [
          {
            id: 'script_step',
            type: 'script_execute',
            script_ref: 'script-5',
            language: 'bash',
            args: {
              app: 'Terminal',
              allowed_apps: ['Terminal', 'Mail'],
            },
          },
        ],
      },
      {
        profile_id: 'policy-apps-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          script_sandbox: {
            allowed_languages: ['bash'],
            allowed_apps: ['Finder'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.filter((error) => error.code === DeterministicRuntimeErrorCodes.ERR_SCRIPT_SANDBOX_DENIED).length).toBeGreaterThanOrEqual(1);
  });

  it('denies tool calls outside tool_allowlist policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-tool-allowlist-0001',
        goal: 'Allowlist tool policy',
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/file.txt' },
            reads: ['/tmp/file.txt'],
          },
        ],
      },
      {
        profile_id: 'policy-tool-allowlist-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          tool_allowlist: ['local://write_file'],
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED)).toBe(true);
  });

  it('denies tool calls present in tool_denylist policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-tool-denylist-0001',
        goal: 'Denylist tool policy',
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/file.txt' },
            reads: ['/tmp/file.txt'],
          },
        ],
      },
      {
        profile_id: 'policy-tool-denylist-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          tool_denylist: ['read_file'],
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED)).toBe(true);
  });

  it('accepts tool calls included in tool_allowlist policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-tool-allowlist-pass-0001',
        goal: 'Allowlist tool policy pass',
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/file.txt' },
            reads: ['/tmp/file.txt'],
          },
        ],
      },
      {
        profile_id: 'policy-tool-allowlist-pass-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp'],
            write: ['/tmp'],
          },
          tool_allowlist: ['local://read_file'],
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('denies step reads/writes outside default_filesystem_scope policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-filesystem-scope-deny-0001',
        goal: 'Filesystem scope deny policy',
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/project/file.txt' },
            reads: ['/tmp/forbidden/file.txt'],
            writes: ['/tmp/project/out.txt'],
          },
        ],
      },
      {
        profile_id: 'policy-fs-scope-deny-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp/project'],
            write: ['/tmp/project'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED
      && error.path.includes('/steps/read_step/reads/0')
    )).toBe(true);
  });

  it('accepts step reads/writes inside default_filesystem_scope policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-filesystem-scope-pass-0001',
        goal: 'Filesystem scope pass policy',
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/project/file.txt' },
            reads: ['/tmp/project/file.txt'],
            writes: ['/tmp/project/build/output.txt'],
          },
        ],
      },
      {
        profile_id: 'policy-fs-scope-pass-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp/project'],
            write: ['/tmp/project'],
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('denies network tool when policy.default_network is deny', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-default-network-deny-0001',
        goal: 'Network policy deny',
        steps: [
          {
            id: 'network_step',
            type: 'tool_call',
            tool_ref: 'local://web_search',
            args: { query: 'ponybunny runtime' },
          },
        ],
      },
      {
        profile_id: 'policy-default-network-deny-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp/project'],
            write: ['/tmp/project'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED
      && error.path.includes('/steps/network_step/tool_ref')
    )).toBe(true);
  });

  it('requires human_confirm dependency for non-idempotent tools', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-risky-tool-approval-0001',
        goal: 'Require approval for dangerous tools',
        steps: [
          {
            id: 'exec_step',
            type: 'tool_call',
            tool_ref: 'local://execute_command',
            args: { command: 'echo hello' },
            reads: ['/tmp/project'],
            writes: ['/tmp/project'],
          },
        ],
      },
      {
        profile_id: 'policy-risky-tool-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'allow',
          default_filesystem_scope: {
            read: ['/tmp/project'],
            write: ['/tmp/project'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_REQUIRE_HUMAN_APPROVAL
      && error.stepId === 'exec_step'
    )).toBe(true);
  });

  it('denies tool_call step missing writes declaration for filesystem write tool', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-filesystem-manifest-writes-0001',
        goal: 'Filesystem write policy declarations',
        steps: [
          {
            id: 'write_step',
            type: 'tool_call',
            tool_ref: 'local://write_file',
            args: { path: '/tmp/project/out.txt', content: 'ok' },
          },
        ],
      },
      {
        profile_id: 'policy-fs-manifest-writes-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp/project'],
            write: ['/tmp/project'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED
      && error.path.includes('/steps/write_step/writes')
    )).toBe(true);
  });

  it('denies plan tool_routing widening beyond runtime profile routing policy', () => {
    const compiler = createCompiler();

    const result = compiler.compile(
      {
        schema_version: 'plan.v1',
        plan_id: 'plan-policy-routing-widening-0001',
        goal: 'Tool routing restrictions',
        tool_routing: {
          mode: 'model_preferred',
          allow_model_native_tools: true,
          resolution_order: ['skills', 'local_tools'],
        },
        steps: [
          {
            id: 'read_step',
            type: 'tool_call',
            tool_ref: 'local://read_file',
            args: { path: '/tmp/project/file.txt' },
            reads: ['/tmp/project/file.txt'],
          },
        ],
      },
      {
        profile_id: 'policy-routing-widening-profile',
        tool_routing: {
          mode: 'system_only',
          allow_model_native_tools: false,
          resolution_order: ['skills', 'local_tools'],
        },
        policy: {
          default_network: 'deny',
          default_filesystem_scope: {
            read: ['/tmp/project'],
            write: ['/tmp/project'],
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) =>
      error.code === DeterministicRuntimeErrorCodes.ERR_POLICY_DENIED
      && error.path.includes('/tool_routing')
    )).toBe(true);
  });
});
