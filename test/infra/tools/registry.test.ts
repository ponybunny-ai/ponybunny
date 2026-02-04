import { jest } from '@jest/globals';
import { ToolRegistry, ToolAllowlist, ToolEnforcer, ToolContext } from '../../../src/infra/tools/tool-registry.js';
import { ReadFileTool } from '../../../src/infra/tools/implementations/read-file-tool.js';
import * as fs from 'node:fs';

jest.mock('node:fs');

describe('ToolRegistry and Execution', () => {
  let registry: ToolRegistry;
  let allowlist: ToolAllowlist;
  let enforcer: ToolEnforcer;
  let context: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    allowlist = new ToolAllowlist([]); // Start empty
    enforcer = new ToolEnforcer(registry, allowlist);
    
    context = {
      cwd: '/test/cwd',
      allowlist,
      enforcer,
    };
  });

  test('should register and execute a tool dynamically', async () => {
    const readFileTool = new ReadFileTool();
    registry.register(readFileTool);
    allowlist.addTool('read_file');

    (fs.readFileSync as jest.Mock).mockReturnValue('file content');

    const tool = registry.getTool('read_file');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ path: '/test/file.txt' }, context);
    expect(result).toBe('file content');
    expect(fs.readFileSync).toHaveBeenCalledWith('/test/file.txt', 'utf-8');
  });

  test('should block execution if tool not allowed', () => {
    const readFileTool = new ReadFileTool();
    registry.register(readFileTool);
    // Not adding to allowlist

    const check = enforcer.checkToolInvocation('read_file', { path: '/foo' });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('not in allowlist');
  });

  test('should block execution if tool not in registry', () => {
    const check = enforcer.checkToolInvocation('ghost_tool', {});
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('not found in registry');
  });
});
