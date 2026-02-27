import { readFileSync } from 'node:fs';
import type { ToolDefinition, ToolContext, ToolManifestV1 } from '../tool-registry.js';

export class ReadFileTool implements ToolDefinition {
  name = 'read_file';
  category = 'filesystem' as const;
  riskLevel = 'safe' as const;
  requiresApproval = false;
  description = 'Read file contents from the local filesystem';
  manifest: ToolManifestV1 = {
    tool_ref: 'local://read_file',
    display_name: 'Read File',
    description: this.description,
    version: 'v1',
    tags: ['filesystem', 'read'],
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
      },
      required: ['path'],
    },
    output_schema: {
      type: 'string',
    },
    side_effect: 'none' as const,
    supports_idempotency_key: true,
    default_timeout_ms: 30000,
    permissions: {
      network: 'deny' as const,
      filesystem: { read: ['*'] },
    },
  };

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
