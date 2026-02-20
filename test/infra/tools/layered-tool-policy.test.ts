import {
  resolveLayeredToolPolicy,
  type LayeredToolPolicy,
} from '../../../src/infra/tools/layered-tool-policy.js';
import { ToolAllowlist, ToolEnforcer, ToolRegistry } from '../../../src/infra/tools/tool-registry.js';

const ALL_TOOLS = ['read_file', 'write_file', 'execute_command', 'search_code', 'web_search', 'find_skills'];

describe('LayeredToolPolicyResolver', () => {
  it('keeps deny sticky across lower-precedence allows', () => {
    const policy: LayeredToolPolicy = {
      global: {
        deny: ['group:runtime'],
      },
      byProvider: {
        'openai/gpt-5.2': {
          allow: ['execute_command'],
        },
      },
    };

    const resolved = resolveLayeredToolPolicy({
      allTools: ALL_TOOLS,
      policy,
      context: { providerId: 'openai/gpt-5.2' },
      baselineAllowedTools: ALL_TOOLS,
    });

    expect(resolved.allowedTools.has('execute_command')).toBe(false);
    expect(resolved.deniedTools.has('execute_command')).toBe(true);
    expect(resolved.denialReasons.get('execute_command')).toContain('global deny policy');
  });

  it('filters owner-only tools for non-owner contexts', () => {
    const policy: LayeredToolPolicy = {
      ownerOnlyTools: ['execute_command', 'write_file'],
    };

    const resolved = resolveLayeredToolPolicy({
      allTools: ALL_TOOLS,
      policy,
      context: { isOwner: false },
      baselineAllowedTools: ALL_TOOLS,
    });

    expect(resolved.allowedTools.has('execute_command')).toBe(false);
    expect(resolved.allowedTools.has('write_file')).toBe(false);
    expect(resolved.allowedTools.has('read_file')).toBe(true);
  });

  it('supports profile + layer override composition deterministically', () => {
    const policy: LayeredToolPolicy = {
      profiles: {
        readonly: ['read_file', 'search_code'],
      },
      global: {
        profile: 'readonly',
      },
      byAgent: {
        reviewer: {
          allow: ['web_search'],
          deny: ['search_code'],
        },
      },
    };

    const resolved = resolveLayeredToolPolicy({
      allTools: ALL_TOOLS,
      policy,
      context: { agentId: 'reviewer' },
      baselineAllowedTools: ALL_TOOLS,
    });

    expect(resolved.allowedTools.has('read_file')).toBe(true);
    expect(resolved.allowedTools.has('web_search')).toBe(true);
    expect(resolved.allowedTools.has('search_code')).toBe(false);
    expect(resolved.appliedLayers).toEqual(['global', 'agent:reviewer']);
  });

  it('applies sandbox layer when sandboxed context is true', () => {
    const policy: LayeredToolPolicy = {
      sandbox: {
        deny: ['write_file'],
      },
    };

    const sandboxed = resolveLayeredToolPolicy({
      allTools: ALL_TOOLS,
      policy,
      context: { sandboxed: true },
      baselineAllowedTools: ALL_TOOLS,
    });
    const normal = resolveLayeredToolPolicy({
      allTools: ALL_TOOLS,
      policy,
      context: { sandboxed: false },
      baselineAllowedTools: ALL_TOOLS,
    });

    expect(sandboxed.allowedTools.has('write_file')).toBe(false);
    expect(normal.allowedTools.has('write_file')).toBe(true);
  });
});

describe('ToolEnforcer layered policy integration', () => {
  const createRegistry = (): ToolRegistry => {
    const registry = new ToolRegistry();

    for (const toolName of ALL_TOOLS) {
      registry.register({
        name: toolName,
        category: toolName === 'execute_command' ? 'shell' : toolName === 'web_search' || toolName === 'find_skills' ? 'network' : 'filesystem',
        riskLevel: toolName === 'execute_command' ? 'dangerous' : 'safe',
        requiresApproval: toolName === 'execute_command',
        description: toolName,
        execute: async () => 'ok',
      });
    }

    return registry;
  };

  it('denies execution when layered policy blocks a baseline-allowed tool', () => {
    const registry = createRegistry();
    const allowlist = new ToolAllowlist(ALL_TOOLS);
    const enforcer = new ToolEnforcer(registry, allowlist, {
      layeredPolicy: {
        global: {
          deny: ['execute_command'],
        },
      },
    });

    const check = enforcer.checkToolInvocation('execute_command', { command: 'npm test' });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('denied by');
  });

  it('allows owner-only tools when owner context is true', () => {
    const registry = createRegistry();
    const allowlist = new ToolAllowlist(ALL_TOOLS);
    const enforcer = new ToolEnforcer(registry, allowlist, {
      layeredPolicy: {
        ownerOnlyTools: ['execute_command'],
      },
      policyContext: {
        isOwner: true,
      },
    });

    const check = enforcer.checkToolInvocation('execute_command', { command: 'npm test' });
    expect(check.allowed).toBe(true);
  });
});
