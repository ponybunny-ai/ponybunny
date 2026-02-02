export interface ToolDefinition {
  name: string;
  category: 'filesystem' | 'shell' | 'network' | 'database' | 'git';
  riskLevel: 'safe' | 'moderate' | 'dangerous';
  requiresApproval: boolean;
  description: string;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  
  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.register({
      name: 'read_file',
      category: 'filesystem',
      riskLevel: 'safe',
      requiresApproval: false,
      description: 'Read file contents',
    });

    this.register({
      name: 'write_file',
      category: 'filesystem',
      riskLevel: 'moderate',
      requiresApproval: false,
      description: 'Write or modify file contents',
    });

    this.register({
      name: 'execute_shell',
      category: 'shell',
      riskLevel: 'dangerous',
      requiresApproval: true,
      description: 'Execute shell command',
    });

    this.register({
      name: 'git_commit',
      category: 'git',
      riskLevel: 'moderate',
      requiresApproval: false,
      description: 'Create git commit',
    });

    this.register({
      name: 'git_push',
      category: 'git',
      riskLevel: 'dangerous',
      requiresApproval: true,
      description: 'Push commits to remote',
    });

    this.register({
      name: 'http_request',
      category: 'network',
      riskLevel: 'dangerous',
      requiresApproval: true,
      description: 'Make HTTP request to external service',
    });
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
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
    
    if (this.allowedTools.size === 0) {
      this.setDefaultAllowlist();
    }
  }

  private setDefaultAllowlist(): void {
    this.allowedTools = new Set([
      'read_file',
      'write_file',
      'git_commit',
    ]);
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
