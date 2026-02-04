import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition, ToolContext } from '../tool-registry.js';

const execAsync = promisify(exec);

export class SearchCodeTool implements ToolDefinition {
  name = 'search_code';
  category = 'code' as const;
  riskLevel = 'safe' as const;
  requiresApproval = false;
  description = 'Search for code patterns in the codebase using grep';

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
