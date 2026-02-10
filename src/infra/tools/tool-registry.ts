export interface ToolContext {
  cwd: string;
  allowlist: ToolAllowlist;
  enforcer: ToolEnforcer;
  workspaceRoot?: string;
}

export interface ToolDefinition {
  name: string;
  category: 'filesystem' | 'shell' | 'network' | 'database' | 'git' | 'code';
  riskLevel: 'safe' | 'moderate' | 'dangerous';
  requiresApproval: boolean;
  description: string;
  execute(args: Record<string, any>, context: ToolContext): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  
  constructor() {}

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  unregister(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.category === category);
  }

  getToolsByRiskLevel(riskLevel: ToolDefinition['riskLevel']): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.riskLevel === riskLevel);
  }
}

export class ToolAllowlist {
  private allowedTools: Set<string>;

  constructor(allowedTools: string[] = []) {
    this.allowedTools = new Set(allowedTools);
  }

  isAllowed(toolName: string): boolean {
    return this.allowedTools.has(toolName);
  }

  addTool(toolName: string): void {

    this.allowedTools.add(toolName);
  }

  removeTool(toolName: string): void {
    this.allowedTools.delete(toolName);
  }

  getAllowedTools(): string[] {
    return Array.from(this.allowedTools);
  }

  filterAllowed(toolNames: string[]): string[] {
    return toolNames.filter(name => this.isAllowed(name));
  }
}

export class ToolEnforcer {
  constructor(
    private registry: ToolRegistry,
    private allowlist: ToolAllowlist
  ) {}

  canExecute(toolName: string): { allowed: boolean; reason?: string } {
    const tool = this.registry.getTool(toolName);
    
    if (!tool) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' not found in registry`,
      };
    }

    if (!this.allowlist.isAllowed(toolName)) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' not in allowlist for this goal`,
      };
    }

    return { allowed: true };
  }

  checkToolInvocation(toolName: string, args: Record<string, unknown>): {
    allowed: boolean;
    reason?: string;
    requiresApproval: boolean;
  } {
    const executeCheck = this.canExecute(toolName);
    
    if (!executeCheck.allowed) {
      return {
        allowed: false,
        reason: executeCheck.reason,
        requiresApproval: false,
      };
    }

    const tool = this.registry.getTool(toolName)!;

    return {
      allowed: true,
      requiresApproval: tool.requiresApproval,
    };
  }
}
