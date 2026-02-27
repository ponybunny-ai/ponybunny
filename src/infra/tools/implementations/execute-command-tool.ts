import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition, ToolContext, ToolManifestV1 } from '../tool-registry.js';

const execAsync = promisify(exec);

export class ExecuteCommandTool implements ToolDefinition {
  name = 'execute_command';
  category = 'shell' as const;
  riskLevel = 'dangerous' as const;
  requiresApproval = true;
  description = 'Execute a shell command';
  manifest: ToolManifestV1 = {
    tool_ref: 'local://execute_command',
    display_name: 'Execute Command',
    description: this.description,
    version: 'v1',
    tags: ['shell', 'command'],
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
    output_schema: {
      type: 'string',
    },
    side_effect: 'non_idempotent' as const,
    supports_idempotency_key: false,
    default_timeout_ms: 30000,
    permissions: {
      network: 'allow' as const,
      filesystem: { read: ['*'], write: ['*'] },
    },
  };

  async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
    if (!args.command || typeof args.command !== 'string') {
      throw new Error('Missing or invalid argument: command');
    }

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: context.cwd,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      return stdout || stderr || 'Command executed successfully (no output)';
    } catch (error: any) {
      return `Command failed (exit code ${error.code || 'unknown'}): ${error.stderr || error.message}`;
    }
  }
}
