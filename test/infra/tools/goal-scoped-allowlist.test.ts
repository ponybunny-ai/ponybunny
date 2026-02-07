import { GoalScopedAllowlist } from '../../../src/infra/tools/goal-scoped-allowlist.js';

describe('GoalScopedAllowlist', () => {
  let allowlist: GoalScopedAllowlist;

  beforeEach(() => {
    allowlist = new GoalScopedAllowlist(
      ['read_file', 'search_code', 'list_directory'],  // default allowed
      ['rm_rf', 'format_disk']  // default blocked
    );
  });

  describe('initialization', () => {
    it('should initialize with default allowed tools', () => {
      expect(allowlist.getDefaultAllowedTools()).toEqual(
        expect.arrayContaining(['read_file', 'search_code', 'list_directory'])
      );
    });

    it('should initialize with default blocked tools', () => {
      expect(allowlist.getDefaultBlockedTools()).toEqual(
        expect.arrayContaining(['rm_rf', 'format_disk'])
      );
    });
  });

  describe('isAllowed', () => {
    it('should allow default allowed tools', () => {
      expect(allowlist.isAllowed('read_file', 'goal-1')).toBe(true);
    });

    it('should block default blocked tools', () => {
      expect(allowlist.isAllowed('rm_rf', 'goal-1')).toBe(false);
    });

    it('should not allow unknown tools by default', () => {
      expect(allowlist.isAllowed('unknown_tool', 'goal-1')).toBe(false);
    });

    it('should allow goal-specific allowed tools', () => {
      allowlist.allowTool('write_file', 'goal-1');
      expect(allowlist.isAllowed('write_file', 'goal-1')).toBe(true);
      expect(allowlist.isAllowed('write_file', 'goal-2')).toBe(false);
    });

    it('should block goal-specific blocked tools', () => {
      allowlist.blockTool('read_file', 'goal-1');
      expect(allowlist.isAllowed('read_file', 'goal-1')).toBe(false);
      expect(allowlist.isAllowed('read_file', 'goal-2')).toBe(true);
    });
  });

  describe('initializeGoal', () => {
    it('should create goal configuration', () => {
      const config = allowlist.initializeGoal('goal-1');
      expect(config.goalId).toBe('goal-1');
      expect(config.allowedTools.size).toBe(0);
      expect(config.blockedTools.size).toBe(0);
    });

    it('should inherit from parent goal', () => {
      allowlist.initializeGoal('parent-goal');
      allowlist.allowTool('custom_tool', 'parent-goal');
      allowlist.blockTool('search_code', 'parent-goal');

      const childConfig = allowlist.initializeGoal('child-goal', 'parent-goal');

      expect(childConfig.allowedTools.has('custom_tool')).toBe(true);
      expect(childConfig.blockedTools.has('search_code')).toBe(true);
    });

    it('should return existing config if already initialized', () => {
      const config1 = allowlist.initializeGoal('goal-1');
      allowlist.allowTool('test_tool', 'goal-1');
      const config2 = allowlist.initializeGoal('goal-1');

      expect(config2.allowedTools.has('test_tool')).toBe(true);
    });
  });

  describe('allowTool', () => {
    it('should add tool to goal allowed list', () => {
      allowlist.allowTool('new_tool', 'goal-1');
      expect(allowlist.isAllowed('new_tool', 'goal-1')).toBe(true);
    });

    it('should remove tool from blocked list when allowed', () => {
      allowlist.blockTool('read_file', 'goal-1');
      expect(allowlist.isAllowed('read_file', 'goal-1')).toBe(false);

      allowlist.allowTool('read_file', 'goal-1');
      expect(allowlist.isAllowed('read_file', 'goal-1')).toBe(true);
    });

    it('should auto-initialize goal if not exists', () => {
      allowlist.allowTool('test_tool', 'new-goal');
      expect(allowlist.getGoalConfig('new-goal')).toBeDefined();
    });
  });

  describe('blockTool', () => {
    it('should add tool to goal blocked list', () => {
      allowlist.blockTool('read_file', 'goal-1');
      expect(allowlist.isBlocked('read_file', 'goal-1')).toBe(true);
    });

    it('should remove tool from allowed list when blocked', () => {
      allowlist.allowTool('custom_tool', 'goal-1');
      expect(allowlist.isAllowed('custom_tool', 'goal-1')).toBe(true);

      allowlist.blockTool('custom_tool', 'goal-1');
      expect(allowlist.isAllowed('custom_tool', 'goal-1')).toBe(false);
    });
  });

  describe('disallowTool', () => {
    it('should remove tool from goal allowed list', () => {
      allowlist.allowTool('custom_tool', 'goal-1');
      expect(allowlist.isAllowed('custom_tool', 'goal-1')).toBe(true);

      allowlist.disallowTool('custom_tool', 'goal-1');
      expect(allowlist.isAllowed('custom_tool', 'goal-1')).toBe(false);
    });
  });

  describe('unblockTool', () => {
    it('should remove tool from goal blocked list', () => {
      allowlist.blockTool('read_file', 'goal-1');
      expect(allowlist.isBlocked('read_file', 'goal-1')).toBe(true);

      allowlist.unblockTool('read_file', 'goal-1');
      expect(allowlist.isBlocked('read_file', 'goal-1')).toBe(false);
    });
  });

  describe('setToolLayer', () => {
    it('should set tool layer for a goal', () => {
      allowlist.setToolLayer('write_file', 'goal-1', 'approval_required');
      expect(allowlist.getToolLayer('write_file', 'goal-1')).toBe('approval_required');
    });

    it('should return undefined for unset layer', () => {
      expect(allowlist.getToolLayer('unknown_tool', 'goal-1')).toBeUndefined();
    });
  });

  describe('getAllowedTools', () => {
    it('should return combined default and goal-specific allowed tools', () => {
      allowlist.allowTool('custom_tool', 'goal-1');
      const allowed = allowlist.getAllowedTools('goal-1');

      expect(allowed).toContain('read_file');
      expect(allowed).toContain('custom_tool');
      expect(allowed).not.toContain('rm_rf');
    });

    it('should exclude goal-blocked tools from defaults', () => {
      allowlist.blockTool('read_file', 'goal-1');
      const allowed = allowlist.getAllowedTools('goal-1');

      expect(allowed).not.toContain('read_file');
      expect(allowed).toContain('search_code');
    });
  });

  describe('getBlockedTools', () => {
    it('should return combined default and goal-specific blocked tools', () => {
      allowlist.blockTool('search_code', 'goal-1');
      const blocked = allowlist.getBlockedTools('goal-1');

      expect(blocked).toContain('rm_rf');
      expect(blocked).toContain('search_code');
    });
  });

  describe('filterAllowed', () => {
    it('should filter tools to only allowed ones', () => {
      allowlist.allowTool('custom_tool', 'goal-1');

      const result = allowlist.filterAllowed(
        ['read_file', 'custom_tool', 'rm_rf', 'unknown'],
        'goal-1'
      );

      expect(result).toEqual(['read_file', 'custom_tool']);
    });
  });

  describe('setAllowedTools', () => {
    it('should replace goal allowed tools', () => {
      allowlist.allowTool('old_tool', 'goal-1');
      allowlist.setAllowedTools(['new_tool_1', 'new_tool_2'], 'goal-1');

      const config = allowlist.getGoalConfig('goal-1');
      expect(config!.allowedTools.has('old_tool')).toBe(false);
      expect(config!.allowedTools.has('new_tool_1')).toBe(true);
      expect(config!.allowedTools.has('new_tool_2')).toBe(true);
    });
  });

  describe('default allowlist management', () => {
    it('should add to default allowed', () => {
      allowlist.addDefaultAllowed('new_default');
      expect(allowlist.getDefaultAllowedTools()).toContain('new_default');
    });

    it('should remove from default allowed', () => {
      allowlist.removeDefaultAllowed('read_file');
      expect(allowlist.getDefaultAllowedTools()).not.toContain('read_file');
    });

    it('should add to default blocked', () => {
      allowlist.addDefaultBlocked('dangerous_tool');
      expect(allowlist.getDefaultBlockedTools()).toContain('dangerous_tool');
    });

    it('should remove from default blocked', () => {
      allowlist.removeDefaultBlocked('rm_rf');
      expect(allowlist.getDefaultBlockedTools()).not.toContain('rm_rf');
    });
  });

  describe('change history', () => {
    it('should record changes', () => {
      allowlist.allowTool('tool1', 'goal-1', 'user-1');
      allowlist.blockTool('tool2', 'goal-1', 'user-1');

      const history = allowlist.getChangeHistory('goal-1');
      expect(history.length).toBe(2);
      expect(history[0].action).toBe('add');
      expect(history[1].action).toBe('block');
    });

    it('should filter history by goal', () => {
      allowlist.allowTool('tool1', 'goal-1');
      allowlist.allowTool('tool2', 'goal-2');

      const history = allowlist.getChangeHistory('goal-1');
      expect(history.length).toBe(1);
      expect(history[0].goalId).toBe('goal-1');
    });

    it('should limit history results', () => {
      for (let i = 0; i < 10; i++) {
        allowlist.allowTool(`tool${i}`, 'goal-1');
      }

      const history = allowlist.getChangeHistory('goal-1', 5);
      expect(history.length).toBe(5);
    });

    it('should clear history', () => {
      allowlist.allowTool('tool1', 'goal-1');
      allowlist.clearChangeHistory();

      const history = allowlist.getChangeHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('serialization', () => {
    it('should export and import configuration', () => {
      allowlist.allowTool('custom_tool', 'goal-1');
      allowlist.blockTool('blocked_tool', 'goal-1');
      allowlist.setToolLayer('layered_tool', 'goal-1', 'forbidden');

      const exported = allowlist.exportConfig();

      const newAllowlist = new GoalScopedAllowlist();
      newAllowlist.importConfig(exported);

      expect(newAllowlist.isAllowed('custom_tool', 'goal-1')).toBe(true);
      expect(newAllowlist.isBlocked('blocked_tool', 'goal-1')).toBe(true);
      expect(newAllowlist.getToolLayer('layered_tool', 'goal-1')).toBe('forbidden');
    });
  });

  describe('removeGoalConfig', () => {
    it('should remove goal configuration', () => {
      allowlist.initializeGoal('goal-1');
      allowlist.allowTool('tool1', 'goal-1');

      const removed = allowlist.removeGoalConfig('goal-1');
      expect(removed).toBe(true);
      expect(allowlist.getGoalConfig('goal-1')).toBeUndefined();
    });

    it('should return false for non-existent goal', () => {
      const removed = allowlist.removeGoalConfig('non-existent');
      expect(removed).toBe(false);
    });
  });
});
