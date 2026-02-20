export interface ToolPolicyLayer {
  profile?: string;
  allow?: string[];
  deny?: string[];
  ownerOnly?: string[];
}

export interface LayeredToolPolicy {
  profiles?: Record<string, string[]>;
  groups?: Record<string, string[]>;
  global?: ToolPolicyLayer;
  byProvider?: Record<string, ToolPolicyLayer>;
  byAgent?: Record<string, ToolPolicyLayer>;
  subagent?: ToolPolicyLayer;
  sandbox?: ToolPolicyLayer;
  ownerOnlyTools?: string[];
}

export interface ToolPolicyContext {
  providerId?: string;
  agentId?: string;
  isSubagent?: boolean;
  sandboxed?: boolean;
  isOwner?: boolean;
}

export interface ToolPolicyResolution {
  allowedTools: Set<string>;
  deniedTools: Set<string>;
  denialReasons: Map<string, string>;
  appliedLayers: string[];
}

const DEFAULT_TOOL_GROUPS: Record<string, string[]> = {
  'group:fs': ['read_file', 'write_file'],
  'group:runtime': ['execute_command'],
  'group:web': ['web_search'],
  'group:skills': ['find_skills'],
  'group:code': ['search_code'],
};

const DEFAULT_TOOL_PROFILES: Record<string, string[]> = {
  minimal: ['read_file', 'search_code'],
  coding: ['group:fs', 'group:runtime', 'group:web', 'group:skills', 'group:code'],
  full: ['*'],
};

interface MutableResolution {
  baselineAllowedTools: Set<string>;
  currentAllowedTools: Set<string>;
  deniedTools: Set<string>;
  denialReasons: Map<string, string>;
  appliedLayers: string[];
}

const normalizeSelectors = (selectors: string[] | undefined): string[] => {
  if (!Array.isArray(selectors)) {
    return [];
  }

  return selectors
    .filter((selector): selector is string => typeof selector === 'string')
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
};

export class LayeredToolPolicyResolver {
  constructor(
    private readonly allTools: string[],
    private readonly policy: LayeredToolPolicy,
    private readonly context: ToolPolicyContext,
    private readonly baselineAllowedTools: string[]
  ) {}

  resolve(): ToolPolicyResolution {
    const state: MutableResolution = {
      baselineAllowedTools: new Set(this.baselineAllowedTools.filter((name) => this.allTools.includes(name))),
      currentAllowedTools: new Set(this.baselineAllowedTools.filter((name) => this.allTools.includes(name))),
      deniedTools: new Set<string>(),
      denialReasons: new Map<string, string>(),
      appliedLayers: [],
    };

    this.applyLayer(state, 'global', this.policy.global);

    if (this.context.providerId && this.policy.byProvider?.[this.context.providerId]) {
      this.applyLayer(state, `provider:${this.context.providerId}`, this.policy.byProvider[this.context.providerId]);
    }

    if (this.context.agentId && this.policy.byAgent?.[this.context.agentId]) {
      this.applyLayer(state, `agent:${this.context.agentId}`, this.policy.byAgent[this.context.agentId]);
    }

    if (this.context.isSubagent && this.policy.subagent) {
      this.applyLayer(state, 'subagent', this.policy.subagent);
    }

    if (this.context.sandboxed && this.policy.sandbox) {
      this.applyLayer(state, 'sandbox', this.policy.sandbox);
    }

    if (this.context.isOwner !== true) {
      const ownerOnlyTools = this.expandSelectors(normalizeSelectors(this.policy.ownerOnlyTools));
      for (const toolName of ownerOnlyTools) {
        this.denyTool(state, toolName, 'owner-only policy');
      }
    }

    return {
      allowedTools: state.currentAllowedTools,
      deniedTools: state.deniedTools,
      denialReasons: state.denialReasons,
      appliedLayers: state.appliedLayers,
    };
  }

  private applyLayer(state: MutableResolution, layerName: string, layer: ToolPolicyLayer | undefined): void {
    if (!layer) {
      return;
    }

    state.appliedLayers.push(layerName);

    if (typeof layer.profile === 'string' && layer.profile.trim().length > 0) {
      const profileTools = this.expandProfile(layer.profile.trim());
      const nextAllowed = new Set<string>();
      for (const toolName of profileTools) {
        if (state.baselineAllowedTools.has(toolName) && !state.deniedTools.has(toolName)) {
          nextAllowed.add(toolName);
        }
      }
      state.currentAllowedTools = nextAllowed;
    }

    const allowTools = this.expandSelectors(normalizeSelectors(layer.allow));
    for (const toolName of allowTools) {
      if (!state.baselineAllowedTools.has(toolName)) {
        continue;
      }
      if (state.deniedTools.has(toolName)) {
        continue;
      }
      state.currentAllowedTools.add(toolName);
    }

    if (this.context.isOwner !== true) {
      const ownerOnlyTools = this.expandSelectors(normalizeSelectors(layer.ownerOnly));
      for (const toolName of ownerOnlyTools) {
        this.denyTool(state, toolName, `${layerName} owner-only policy`);
      }
    }

    const denyTools = this.expandSelectors(normalizeSelectors(layer.deny));
    for (const toolName of denyTools) {
      this.denyTool(state, toolName, `${layerName} deny policy`);
    }
  }

  private denyTool(state: MutableResolution, toolName: string, reason: string): void {
    state.deniedTools.add(toolName);
    state.currentAllowedTools.delete(toolName);
    if (!state.denialReasons.has(toolName)) {
      state.denialReasons.set(toolName, reason);
    }
  }

  private expandProfile(profileName: string): Set<string> {
    const profileSelectors = this.policy.profiles?.[profileName] ?? DEFAULT_TOOL_PROFILES[profileName] ?? [];
    return this.expandSelectors(profileSelectors);
  }

  private expandSelectors(selectors: string[]): Set<string> {
    const resolved = new Set<string>();

    for (const selector of selectors) {
      if (selector === '*') {
        for (const toolName of this.allTools) {
          resolved.add(toolName);
        }
        continue;
      }

      if (selector.startsWith('group:')) {
        const groupTools = this.policy.groups?.[selector] ?? DEFAULT_TOOL_GROUPS[selector] ?? [];
        for (const toolName of groupTools) {
          if (this.allTools.includes(toolName)) {
            resolved.add(toolName);
          }
        }
        continue;
      }

      if (this.allTools.includes(selector)) {
        resolved.add(selector);
      }
    }

    return resolved;
  }
}

export function resolveLayeredToolPolicy(params: {
  allTools: string[];
  policy: LayeredToolPolicy;
  context?: ToolPolicyContext;
  baselineAllowedTools: string[];
}): ToolPolicyResolution {
  const resolver = new LayeredToolPolicyResolver(
    params.allTools,
    params.policy,
    params.context ?? {},
    params.baselineAllowedTools
  );

  return resolver.resolve();
}
