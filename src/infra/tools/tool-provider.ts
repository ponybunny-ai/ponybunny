/**
 * Tool Provider
 * Provides tool summaries for system prompt generation
 */

import type { ToolSummary } from '../prompts/types.js';
import type { ToolEnforcer } from './tool-registry.js';

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
