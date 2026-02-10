/**
 * Tool Provider
 * Provides tool definitions for LLM native tool calling
 * Dynamically reads from ToolRegistry to include all registered tools (built-in + MCP)
 */

import type { ToolSummary } from '../prompts/types.js';
import type { ToolRegistry, ToolEnforcer } from './tool-registry.js';
import type { ToolDefinition as LLMToolDefinition } from '../llm/llm-provider.js';
import type { MCPToolDefinition } from '../mcp/client/types.js';

/**
 * Built-in parameter schemas for core tools.
 * These are used when the ToolRegistry doesn't carry its own JSON Schema.
 */
const BUILTIN_PARAMETER_SCHEMAS: Record<string, LLMToolDefinition['parameters']> = {
  read_file: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read',
      },
    },
    required: ['path'],
  },
  write_file: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  edit_file: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to edit',
      },
      old_text: {
        type: 'string',
        description: 'Text to replace',
      },
      new_text: {
        type: 'string',
        description: 'New text to insert',
      },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  execute_command: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
    },
    required: ['command'],
  },
  list_dir: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list',
      },
    },
    required: ['path'],
  },
  search_code: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      path: {
        type: 'string',
        description: 'Optional path to search within',
      },
    },
    required: ['query'],
  },
  web_search: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
    },
    required: ['query'],
  },
  find_skills: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Skill search query',
      },
      install: {
        type: 'boolean',
        description: 'Whether to install the first matching skill',
      },
    },
    required: ['query'],
  },
  analyze_dependencies: {
    type: 'object',
    properties: {
      work_items: {
        type: 'array',
        description: 'Array of work item IDs to analyze',
        items: {
          type: 'string',
        },
      },
    },
    required: ['work_items'],
  },
  create_artifact: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Artifact name',
      },
      type: {
        type: 'string',
        description: 'Artifact type (file, test_result, etc.)',
      },
      content: {
        type: 'string',
        description: 'Artifact content',
      },
    },
    required: ['name', 'type', 'content'],
  },
  run_quality_gate: {
    type: 'object',
    properties: {
      gate_type: {
        type: 'string',
        description: 'Type of quality gate (tests, lint, build)',
      },
    },
    required: ['gate_type'],
  },
  escalate: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Reason for escalation',
      },
      context: {
        type: 'string',
        description: 'Additional context',
      },
      options: {
        type: 'array',
        description: 'Suggested options for user',
        items: {
          type: 'string',
        },
      },
    },
    required: ['reason'],
  },
  complete_task: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Summary of what was accomplished',
      },
    },
    required: ['summary'],
  },
};

/**
 * Phase-specific tool names that are only available in certain lifecycle phases
 */
const PHASE_TOOLS: Record<string, string[]> = {
  planning: ['analyze_dependencies'],
  execution: ['create_artifact'],
  verification: ['run_quality_gate'],
  evaluation: ['escalate'],
};

export class ToolProvider {
  private _registry: ToolRegistry | null;

  constructor(private _toolEnforcer?: ToolEnforcer) {
    this._registry = _toolEnforcer?.registry ?? null;
  }

  /**
   * Set or update the ToolRegistry (needed for late initialization, e.g. after MCP tools are registered)
   */
  setRegistry(registry: ToolRegistry): void {
    this._registry = registry;
  }

  /**
   * Get available tools as summaries for system prompts
   */
  getToolSummaries(phase?: string): ToolSummary[] {
    if (this._registry) {
      return this.getToolSummariesFromRegistry(phase);
    }
    return this.getStaticToolSummaries(phase);
  }

  /**
   * Get tool definitions in LLM-native format (JSON Schema)
   * Dynamically reads from ToolRegistry to include all registered tools (built-in + MCP)
   */
  getToolDefinitions(phase?: string): LLMToolDefinition[] {
    if (this._registry) {
      return this.getToolDefinitionsFromRegistry(phase);
    }
    return this.getStaticToolDefinitions(phase);
  }

  /**
   * Build LLM tool definitions dynamically from ToolRegistry
   */
  private getToolDefinitionsFromRegistry(phase?: string): LLMToolDefinition[] {
    const registry = this._registry!;
    const allTools = registry.getAllTools();
    const phaseFilter = phase ? (PHASE_TOOLS[phase] ?? []) : [];
    const allPhaseToolNames = Object.values(PHASE_TOOLS).flat();

    const definitions: LLMToolDefinition[] = [];

    for (const tool of allTools) {
      // Skip phase-specific tools that don't belong to the current phase
      const isPhaseSpecific = allPhaseToolNames.includes(tool.name);
      if (isPhaseSpecific && !phaseFilter.includes(tool.name)) {
        continue;
      }

      if (tool.name.startsWith('mcp_')) {
        definitions.push(this.buildMCPToolDefinition(tool));
      } else {
        definitions.push(this.buildBuiltinToolDefinition(tool));
      }
    }

    // Always include the complete_task virtual tool
    definitions.push({
      name: 'complete_task',
      description: 'Mark the current task as complete with a summary',
      parameters: BUILTIN_PARAMETER_SCHEMAS['complete_task']!,
    });

    return definitions;
  }

  /**
   * Build LLM tool definition for a built-in tool from ToolRegistry
   */
  private buildBuiltinToolDefinition(tool: import('./tool-registry.js').ToolDefinition): LLMToolDefinition {
    const parameters = BUILTIN_PARAMETER_SCHEMAS[tool.name] ?? {
      type: 'object' as const,
      properties: {},
    };

    return {
      name: tool.name,
      description: tool.description,
      parameters,
    };
  }

  /**
   * Build LLM tool definition for an MCP tool
   * MCP tools carry their own inputSchema cached during registration
   */
  private buildMCPToolDefinition(tool: import('./tool-registry.js').ToolDefinition): LLMToolDefinition {
    const mcpSchema = mcpToolSchemaCache.get(tool.name);

    return {
      name: tool.name,
      description: tool.description,
      parameters: mcpSchema ?? {
        type: 'object' as const,
        properties: {},
      },
    };
  }

  /**
   * Get tool summaries dynamically from ToolRegistry
   */
  private getToolSummariesFromRegistry(phase?: string): ToolSummary[] {
    const registry = this._registry!;
    const allTools = registry.getAllTools();
    const phaseFilter = phase ? (PHASE_TOOLS[phase] ?? []) : [];
    const allPhaseToolNames = Object.values(PHASE_TOOLS).flat();

    const summaries: ToolSummary[] = [];

    for (const tool of allTools) {
      const isPhaseSpecific = allPhaseToolNames.includes(tool.name);
      if (isPhaseSpecific && !phaseFilter.includes(tool.name)) {
        continue;
      }

      const category = tool.name.startsWith('mcp_') ? 'mcp' :
                        ['read_file', 'write_file', 'edit_file', 'execute_command', 'list_dir', 'search_code'].includes(tool.name) ? 'core' : 'domain';

      summaries.push({
        name: tool.name,
        description: tool.description,
        category,
      });
    }

    return summaries;
  }

  /**
   * Static fallback: tool summaries when no registry is available
   */
  private getStaticToolSummaries(phase?: string): ToolSummary[] {
    const coreTools: ToolSummary[] = [
      { name: 'read_file', description: 'Read file contents from the workspace', category: 'core' },
      { name: 'write_file', description: 'Write or create files in the workspace', category: 'core' },
      { name: 'edit_file', description: 'Make precise edits to existing files', category: 'core' },
      { name: 'execute_command', description: 'Execute shell commands (with sandboxing)', category: 'core' },
      { name: 'list_dir', description: 'List directory contents', category: 'core' },
      { name: 'search_code', description: 'Search for files or content in the workspace', category: 'core' },
    ];

    const domainTools: ToolSummary[] = [
      { name: 'web_search', description: 'Search the web for information', category: 'domain' },
      { name: 'find_skills', description: 'Search and install skills from skills.sh marketplace', category: 'domain' },
    ];

    const phaseTools = this.getPhaseSpecificSummaries(phase);

    return [...coreTools, ...domainTools, ...phaseTools];
  }

  /**
   * Static fallback: tool definitions when no registry is available
   */
  private getStaticToolDefinitions(phase?: string): LLMToolDefinition[] {
    const summaries = this.getStaticToolSummaries(phase);

    return summaries.map(summary => ({
      name: summary.name,
      description: summary.description,
      parameters: BUILTIN_PARAMETER_SCHEMAS[summary.name] ?? {
        type: 'object' as const,
        properties: {},
      },
    }));
  }

  private getPhaseSpecificSummaries(phase?: string): ToolSummary[] {
    if (!phase) return [];

    const phaseToolMap: Record<string, ToolSummary[]> = {
      planning: [
        { name: 'analyze_dependencies', description: 'Analyze and validate dependency graph', category: 'domain' },
      ],
      execution: [
        { name: 'create_artifact', description: 'Create and register an artifact', category: 'domain' },
      ],
      verification: [
        { name: 'run_quality_gate', description: 'Execute a quality gate check', category: 'domain' },
      ],
      evaluation: [
        { name: 'escalate', description: 'Escalate to user with context and options', category: 'domain' },
      ],
    };

    return phaseToolMap[phase] ?? [];
  }

  /**
   * Get tools filtered by policy
   */
  getToolsForPhase(phase: string, options?: { allowList?: string[] }): ToolSummary[] {
    const allTools = this.getToolSummaries(phase);

    if (options?.allowList && options.allowList.length > 0) {
      const allowSet = new Set(options.allowList);
      return allTools.filter(tool => allowSet.has(tool.name));
    }

    return allTools;
  }
}

/**
 * Cache for MCP tool schemas, populated during tool registration
 */
const mcpToolSchemaCache = new Map<string, LLMToolDefinition['parameters']>();

/**
 * Register an MCP tool's input schema for LLM tool definition generation
 */
export function cacheMCPToolSchema(
  namespacedName: string,
  inputSchema: MCPToolDefinition['inputSchema']
): void {
  mcpToolSchemaCache.set(namespacedName, {
    type: 'object',
    properties: inputSchema.properties ?? {},
    required: inputSchema.required,
  });
}

/**
 * Clear all cached MCP tool schemas
 */
export function clearMCPToolSchemaCache(): void {
  mcpToolSchemaCache.clear();
}

// Singleton instance
let globalToolProvider: ToolProvider | null = null;

export function getGlobalToolProvider(): ToolProvider {
  if (!globalToolProvider) {
    globalToolProvider = new ToolProvider();
  }
  return globalToolProvider;
}

export function setGlobalToolProvider(provider: ToolProvider): void {
  globalToolProvider = provider;
}
