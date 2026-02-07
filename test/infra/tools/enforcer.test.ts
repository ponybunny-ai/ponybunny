import { ToolRegistry, ToolAllowlist } from '../../../src/infra/tools/tool-registry.js';
import { EnhancedToolEnforcer, DEFAULT_TOOL_LAYERS } from '../../../src/infra/tools/enhanced-enforcer.js';
import {
  matchesForbiddenPattern,
  checkForbiddenPatterns,
  FORBIDDEN_SHELL_PATTERNS,
  FORBIDDEN_DATABASE_PATTERNS,
} from '../../../src/infra/tools/forbidden-patterns.js';

describe('ForbiddenPatterns', () => {
  describe('matchesForbiddenPattern', () => {
    it('should detect rm -rf /', () => {
      const match = matchesForbiddenPattern('rm -rf /');
      expect(match).not.toBeNull();
      expect(match!.id).toBe('shell_rm_rf_root');
    });

    it('should detect rm -rf /usr', () => {
      const match = matchesForbiddenPattern('rm -rf /usr');
      expect(match).not.toBeNull();
      expect(match!.category).toBe('shell');
    });

    it('should detect DROP DATABASE', () => {
      const match = matchesForbiddenPattern('DROP DATABASE production');
      expect(match).not.toBeNull();
      expect(match!.id).toBe('db_drop_database');
    });

    it('should detect cloud metadata access', () => {
      const match = matchesForbiddenPattern('http://169.254.169.254/latest/meta-data/');
      expect(match).not.toBeNull();
      expect(match!.id).toBe('net_internal_metadata');
    });

    it('should detect force push to main', () => {
      const match = matchesForbiddenPattern('git push -f origin main');
      expect(match).not.toBeNull();
      expect(match!.id).toBe('git_force_push_main');
    });

    it('should not match safe commands', () => {
      expect(matchesForbiddenPattern('ls -la')).toBeNull();
      expect(matchesForbiddenPattern('npm install')).toBeNull();
      expect(matchesForbiddenPattern('git status')).toBeNull();
    });
  });

  describe('checkForbiddenPatterns', () => {
    it('should check object arguments for forbidden patterns', () => {
      const result = checkForbiddenPatterns({
        command: 'rm -rf /',
        cwd: '/home/user',
      });

      expect(result.forbidden).toBe(true);
      expect(result.field).toBe('command');
      expect(result.pattern).toBeDefined();
    });

    it('should return false for safe arguments', () => {
      const result = checkForbiddenPatterns({
        command: 'npm test',
        cwd: '/home/user/project',
      });

      expect(result.forbidden).toBe(false);
    });

    it('should filter by category', () => {
      const result = checkForbiddenPatterns(
        { query: 'DROP DATABASE test' },
        'database'
      );

      expect(result.forbidden).toBe(true);
    });
  });
});

describe('EnhancedToolEnforcer', () => {
  let registry: ToolRegistry;
  let enforcer: EnhancedToolEnforcer;

  beforeEach(() => {
    registry = new ToolRegistry();

    // Register some test tools
    registry.register({
      name: 'read_file',
      category: 'filesystem',
      riskLevel: 'safe',
      requiresApproval: false,
      description: 'Read a file',
      execute: async () => 'content',
    });

    registry.register({
      name: 'write_file',
      category: 'filesystem',
      riskLevel: 'moderate',
      requiresApproval: true,
      description: 'Write a file',
      execute: async () => 'ok',
    });

    registry.register({
      name: 'execute_command',
      category: 'shell',
      riskLevel: 'dangerous',
      requiresApproval: true,
      description: 'Execute a shell command',
      execute: async () => 'output',
    });

    enforcer = new EnhancedToolEnforcer(registry);
  });

  describe('getToolLayer', () => {
    it('should return autonomous for safe read-only tools', () => {
      expect(enforcer.getToolLayer('read_file')).toBe('autonomous');
    });

    it('should return approval_required for dangerous tools', () => {
      expect(enforcer.getToolLayer('execute_command')).toBe('approval_required');
    });
  });

  describe('checkInvocation', () => {
    it('should allow autonomous tools without approval', () => {
      const result = enforcer.checkInvocation(
        'read_file',
        { path: '/tmp/test.txt' },
        { goalId: 'goal-1' }
      );

      expect(result.allowed).toBe(true);
      expect(result.layer).toBe('autonomous');
    });

    it('should require approval for approval_required tools', () => {
      const result = enforcer.checkInvocation(
        'execute_command',
        { command: 'npm test' },
        { goalId: 'goal-1' }
      );

      expect(result.allowed).toBe(false);
      expect(result.layer).toBe('approval_required');
      expect(result.requires_approval).toBe(true);
    });

    it('should block forbidden patterns', () => {
      const result = enforcer.checkInvocation(
        'execute_command',
        { command: 'rm -rf /' },
        { goalId: 'goal-1' }
      );

      expect(result.allowed).toBe(false);
      expect(result.layer).toBe('forbidden');
      expect(result.forbidden_pattern).toBeDefined();
    });

    it('should return not found for unknown tools', () => {
      const result = enforcer.checkInvocation(
        'unknown_tool',
        {},
        { goalId: 'goal-1' }
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('permission grants', () => {
    it('should allow approved tools with cached grant', () => {
      // First check should require approval
      let result = enforcer.checkInvocation(
        'execute_command',
        { command: 'npm test' },
        { goalId: 'goal-1' }
      );
      expect(result.requires_approval).toBe(true);

      // Grant permission
      enforcer.grantPermission('execute_command', 'goal-1', 'user-123');

      // Second check should be allowed
      result = enforcer.checkInvocation(
        'execute_command',
        { command: 'npm test' },
        { goalId: 'goal-1' }
      );
      expect(result.allowed).toBe(true);
    });

    it('should revoke permissions for a goal', () => {
      enforcer.grantPermission('execute_command', 'goal-1', 'user-123');
      expect(enforcer.hasPermissionGrant('execute_command', 'goal-1')).toBe(true);

      enforcer.revokeAllForGoal('goal-1');
      expect(enforcer.hasPermissionGrant('execute_command', 'goal-1')).toBe(false);
    });

    it('should still block forbidden patterns even with grant', () => {
      enforcer.grantPermission('execute_command', 'goal-1', 'user-123');

      const result = enforcer.checkInvocation(
        'execute_command',
        { command: 'rm -rf /' },
        { goalId: 'goal-1' }
      );

      // Should still be blocked
      expect(result.allowed).toBe(false);
      expect(result.layer).toBe('forbidden');
    });
  });

  describe('getLayerSummary', () => {
    it('should return tools grouped by layer', () => {
      const summary = enforcer.getLayerSummary();

      expect(summary.autonomous).toContain('read_file');
      expect(summary.approval_required).toContain('execute_command');
    });
  });
});
