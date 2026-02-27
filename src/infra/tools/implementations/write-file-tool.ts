import { writeFileSync } from 'node:fs';
import type { ToolDefinition, ToolContext, ToolManifestV1 } from '../tool-registry.js';

export class WriteFileTool implements ToolDefinition {
  name = 'write_file';
  category = 'filesystem' as const;
  riskLevel = 'moderate' as const;
  requiresApproval = false;
  description = 'Write content to a file in the local filesystem';
  manifest: ToolManifestV1 = {
    tool_ref: 'local://write_file',
    display_name: 'Write File',
    description: this.description,
    version: 'v1',
    tags: ['filesystem', 'write'],
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
    output_schema: {
      type: 'string',
    },
    side_effect: 'idempotent' as const,
    supports_idempotency_key: true,
    default_timeout_ms: 30000,
    permissions: {
      network: 'deny' as const,
      filesystem: { write: ['*'] },
    },
  };

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
