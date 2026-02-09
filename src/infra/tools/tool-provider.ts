/**
 * Tool Provider
 * Provides tool summaries for system prompt generation
 */

import type { ToolSummary } from '../prompts/types.js';
import type { ToolEnforcer } from './tool-registry.js';
import type { ToolDefinition as LLMToolDefinition } from '../llm/llm-provider.js';

export class ToolProvider {
  constructor(private _toolEnforcer?: ToolEnforcer) {}

  /**
   * Get available tools as summaries for system prompts
   */
  getToolSummaries(phase?: string): ToolSummary[] {
    // Core tools available in all phases
    const coreTools: ToolSummary[] = [
      {
        name: 'read',
        description: 'Read file contents from the workspace',
        category: 'core',
      },
      {
        name: 'write',
        description: 'Write or create files in the workspace',
        category: 'core',
      },
      {
        name: 'edit',
        description: 'Make precise edits to existing files',
        category: 'core',
      },
      {
        name: 'exec',
        description: 'Execute shell commands (with sandboxing)',
        category: 'core',
      },
      {
        name: 'list_dir',
        description: 'List directory contents',
        category: 'core',
      },
      {
        name: 'search',
        description: 'Search for files or content in the workspace',
        category: 'core',
      },
    ];

    // Domain-specific tools
    const domainTools: ToolSummary[] = [
      {
        name: 'web_search',
        description: 'Search the web for information',
        category: 'domain',
      },
      {
        name: 'find_skills',
        description: 'Search and install skills from skills.sh marketplace',
        category: 'domain',
      },
    ];

    // Phase-specific tools
    const phaseTools = this.getPhaseSpecificTools(phase);

    return [...coreTools, ...domainTools, ...phaseTools];
  }

  /**
   * Get tool definitions in LLM-native format (JSON Schema)
   * This is used for native tool calling with LLM providers
   */
  getToolDefinitions(phase?: string): LLMToolDefinition[] {
    const summaries = this.getToolSummaries(phase);

    return summaries.map(summary => {
      // Generate JSON Schema based on tool name
      const parameters = this.getToolParameters(summary.name);

      return {
        name: summary.name,
        description: summary.description,
        parameters,
      };
    });
  }

  /**
   * Get JSON Schema parameters for a specific tool
   */
  private getToolParameters(toolName: string): LLMToolDefinition['parameters'] {
    const parameterSchemas: Record<string, LLMToolDefinition['parameters']> = {
      read: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to read',
          },
        },
        required: ['path'],
      },
      write: {
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
      edit: {
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
      exec: {
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
      search: {
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
    };

    return parameterSchemas[toolName] || {
      type: 'object',
      properties: {},
    };
  }

  private getPhaseSpecificTools(phase?: string): ToolSummary[] {
    if (!phase) return [];

    const phaseToolMap: Record<string, ToolSummary[]> = {
      planning: [
        {
          name: 'analyze_dependencies',
          description: 'Analyze and validate dependency graph',
          category: 'domain',
        },
      ],
      execution: [
        {
          name: 'create_artifact',
          description: 'Create and register an artifact',
          category: 'domain',
        },
      ],
      verification: [
        {
          name: 'run_quality_gate',
          description: 'Execute a quality gate check',
          category: 'domain',
        },
      ],
      evaluation: [
        {
          name: 'escalate',
          description: 'Escalate to user with context and options',
          category: 'domain',
        },
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

// Singleton instance
let globalToolProvider: ToolProvider | null = null;

export function getGlobalToolProvider(): ToolProvider {
  if (!globalToolProvider) {
    globalToolProvider = new ToolProvider();
  }
  return globalToolProvider;
}
