import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition, ToolContext } from '../tool-registry.js';

const execAsync = promisify(exec);

export class ExecuteCommandTool implements ToolDefinition {
  name = 'execute_command';
  category = 'shell' as const;
  riskLevel = 'dangerous' as const;
  requiresApproval = true;
  description = 'Execute a shell command';

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
