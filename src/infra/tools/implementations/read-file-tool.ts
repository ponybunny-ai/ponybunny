import { readFileSync } from 'node:fs';
import type { ToolDefinition, ToolContext } from '../tool-registry.js';

export class ReadFileTool implements ToolDefinition {
  name = 'read_file';
  category = 'filesystem' as const;
  riskLevel = 'safe' as const;
  requiresApproval = false;
  description = 'Read file contents from the local filesystem';

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    if (!args.path || typeof args.path !== 'string') {
      throw new Error('Missing or invalid argument: path');
    }

    try {
      return readFileSync(args.path, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${args.path}: ${(error as Error).message}`);
    }
  }
}
