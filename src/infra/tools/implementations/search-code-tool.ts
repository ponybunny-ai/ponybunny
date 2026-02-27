import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition, ToolContext, ToolManifestV1 } from '../tool-registry.js';

const execAsync = promisify(exec);

export class SearchCodeTool implements ToolDefinition {
  name = 'search_code';
  category = 'code' as const;
  riskLevel = 'safe' as const;
  requiresApproval = false;
  description = 'Search for code patterns in the codebase using grep';
  manifest: ToolManifestV1 = {
    tool_ref: 'local://search_code',
    display_name: 'Search Code',
    description: this.description,
    version: 'v1',
    tags: ['code', 'search'],
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Pattern to search' },
      },
      required: ['pattern'],
    },
    output_schema: {
      type: 'string',
    },
    side_effect: 'none' as const,
    supports_idempotency_key: true,
    default_timeout_ms: 10000,
    permissions: {
      network: 'deny' as const,
      filesystem: { read: ['*'] },
    },
  };

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    if (!args.pattern || typeof args.pattern !== 'string') {
      throw new Error('Missing or invalid argument: pattern');
    }

    try {
      const command = `git grep -n "${args.pattern}" || grep -r -n "${args.pattern}" .`;
      
      const { stdout } = await execAsync(command, {
        cwd: context.cwd,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });

      if (!stdout.trim()) {
        return `No matches found for pattern: ${args.pattern}`;
      }

      const lines = stdout.split('\n');
      if (lines.length > 50) {
        return lines.slice(0, 50).join('\n') + `\n... (${lines.length - 50} more matches)`;
      }

      return stdout;
    } catch (error: any) {
      if (error.code === 1) {
        return `No matches found for pattern: ${args.pattern}`;
      }
      return `Search failed: ${error.message}`;
    }
  }
}
