import { writeFileSync } from 'node:fs';
import type { ToolDefinition, ToolContext } from '../tool-registry.js';

export class WriteFileTool implements ToolDefinition {
  name = 'write_file';
  category = 'filesystem' as const;
  riskLevel = 'moderate' as const;
  requiresApproval = false;
  description = 'Write content to a file in the local filesystem';

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    if (!args.path || typeof args.path !== 'string') {
      throw new Error('Missing or invalid argument: path');
    }
    if (args.content === undefined || typeof args.content !== 'string') {
      throw new Error('Missing or invalid argument: content');
    }

    try {
      writeFileSync(args.path, args.content, 'utf-8');
      return `Successfully wrote ${args.content.length} bytes to ${args.path}`;
    } catch (error) {
      throw new Error(`Failed to write file ${args.path}: ${(error as Error).message}`);
    }
  }
}
