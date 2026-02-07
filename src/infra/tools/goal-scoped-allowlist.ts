/**
 * Goal-Scoped Tool Allowlist
 *
 * Extends the basic ToolAllowlist to support per-goal tool permissions.
 * Each goal can have its own set of allowed tools, with inheritance from
 * default allowlists and parent goals.
 */

import type { ResponsibilityLayer } from '../../domain/permission/types.js';

// ============================================================================
// Types
// ============================================================================

export interface IGoalToolConfig {
  goalId: string;
  allowedTools: Set<string>;
  blockedTools: Set<string>;
  toolLayers: Map<string, ResponsibilityLayer>;
  parentGoalId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IToolAllowlistChange {
  goalId: string;
  action: 'add' | 'remove' | 'block' | 'unblock' | 'set_layer';
  toolName: string;
  layer?: ResponsibilityLayer;
  timestamp: number;
  changedBy?: string;
}

// ============================================================================
// Goal-Scoped Tool Allowlist
// ============================================================================

export class GoalScopedAllowlist {
  private goalConfigs = new Map<string, IGoalToolConfig>();
  private defaultAllowedTools: Set<string>;
  private defaultBlockedTools: Set<string>;
  private changeHistory: IToolAllowlistChange[] = [];

  constructor(
    defaultAllowed: string[] = [],
    defaultBlocked: string[] = []
  ) {
    this.defaultAllowedTools = new Set(defaultAllowed);
    this.defaultBlockedTools = new Set(defaultBlocked);
  }

  // ============================================================================
  // Goal Configuration Management
  // ============================================================================

  /**
   * Initialize tool configuration for a goal
   */
  initializeGoal(goalId: string, parentGoalId?: string): IGoalToolConfig {
    const existing = this.goalConfigs.get(goalId);
    if (existing) {
      return existing;
    }

    const config: IGoalToolConfig = {
      goalId,
      allowedTools: new Set(),
      blockedTools: new Set(),
      toolLayers: new Map(),
      parentGoalId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Inherit from parent if specified
    if (parentGoalId) {
      const parentConfig = this.goalConfigs.get(parentGoalId);
      if (parentConfig) {
        config.allowedTools = new Set(parentConfig.allowedTools);
        config.blockedTools = new Set(parentConfig.blockedTools);
        config.toolLayers = new Map(parentConfig.toolLayers);
      }
    }

    this.goalConfigs.set(goalId, config);
    return config;
  }

  /**
   * Get tool configuration for a goal
   */
  getGoalConfig(goalId: string): IGoalToolConfig | undefined {
    return this.goalConfigs.get(goalId);
  }

  /**
   * Remove tool configuration for a goal
   */
  removeGoalConfig(goalId: string): boolean {
    return this.goalConfigs.delete(goalId);
  }

  // ============================================================================
  // Tool Permission Checking
  // ============================================================================

  /**
   * Check if a tool is allowed for a specific goal
   */
  isAllowed(toolName: string, goalId: string): boolean {
    // Check if explicitly blocked globally
    if (this.defaultBlockedTools.has(toolName)) {
      return false;
    }

    const config = this.goalConfigs.get(goalId);

    if (config) {
      // Check goal-specific block list
      if (config.blockedTools.has(toolName)) {
        return false;
      }

      // Check goal-specific allow list
      if (config.allowedTools.has(toolName)) {
        return true;
      }
    }

    // Fall back to default allowlist
    return this.defaultAllowedTools.has(toolName);
  }

  /**
   * Check if a tool is explicitly blocked for a goal
   */
  isBlocked(toolName: string, goalId: string): boolean {
    if (this.defaultBlockedTools.has(toolName)) {
      return true;
    }

    const config = this.goalConfigs.get(goalId);
    return config?.blockedTools.has(toolName) ?? false;
  }

  /**
   * Get the responsibility layer for a tool in a goal context
   */
  getToolLayer(toolName: string, goalId: string): ResponsibilityLayer | undefined {
    const config = this.goalConfigs.get(goalId);
    return config?.toolLayers.get(toolName);
  }

  // ============================================================================
  // Tool Permission Modification
  // ============================================================================

  /**
   * Add a tool to the allowed list for a goal
   */
  allowTool(toolName: string, goalId: string, changedBy?: string): void {
    let config = this.goalConfigs.get(goalId);
    if (!config) {
      config = this.initializeGoal(goalId);
    }

    config.allowedTools.add(toolName);
    config.blockedTools.delete(toolName);
    config.updatedAt = Date.now();

    this.recordChange({
      goalId,
      action: 'add',
      toolName,
      timestamp: Date.now(),
      changedBy,
    });
  }

  /**
   * Remove a tool from the allowed list for a goal
   */
  disallowTool(toolName: string, goalId: string, changedBy?: string): void {
    const config = this.goalConfigs.get(goalId);
    if (!config) return;

    config.allowedTools.delete(toolName);
    config.updatedAt = Date.now();

    this.recordChange({
      goalId,
      action: 'remove',
      toolName,
      timestamp: Date.now(),
      changedBy,
    });
  }

  /**
   * Block a tool for a goal (overrides default allow)
   */
  blockTool(toolName: string, goalId: string, changedBy?: string): void {
    let config = this.goalConfigs.get(goalId);
    if (!config) {
      config = this.initializeGoal(goalId);
    }

    config.blockedTools.add(toolName);
    config.allowedTools.delete(toolName);
    config.updatedAt = Date.now();

    this.recordChange({
      goalId,
      action: 'block',
      toolName,
      timestamp: Date.now(),
      changedBy,
    });
  }

  /**
   * Unblock a tool for a goal
   */
  unblockTool(toolName: string, goalId: string, changedBy?: string): void {
    const config = this.goalConfigs.get(goalId);
    if (!config) return;

    config.blockedTools.delete(toolName);
    config.updatedAt = Date.now();

    this.recordChange({
      goalId,
      action: 'unblock',
      toolName,
      timestamp: Date.now(),
      changedBy,
    });
  }

  /**
   * Set the responsibility layer for a tool in a goal
   */
  setToolLayer(
    toolName: string,
    goalId: string,
    layer: ResponsibilityLayer,
    changedBy?: string
  ): void {
    let config = this.goalConfigs.get(goalId);
    if (!config) {
      config = this.initializeGoal(goalId);
    }

    config.toolLayers.set(toolName, layer);
    config.updatedAt = Date.now();

    this.recordChange({
      goalId,
      action: 'set_layer',
      toolName,
      layer,
      timestamp: Date.now(),
      changedBy,
    });
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Set allowed tools for a goal (replaces existing)
   */
  setAllowedTools(toolNames: string[], goalId: string, changedBy?: string): void {
    let config = this.goalConfigs.get(goalId);
    if (!config) {
      config = this.initializeGoal(goalId);
    }

    config.allowedTools = new Set(toolNames);
    config.updatedAt = Date.now();

    for (const toolName of toolNames) {
      this.recordChange({
        goalId,
        action: 'add',
        toolName,
        timestamp: Date.now(),
        changedBy,
      });
    }
  }

  /**
   * Get all allowed tools for a goal (including defaults)
   */
  getAllowedTools(goalId: string): string[] {
    const config = this.goalConfigs.get(goalId);
    const result = new Set(this.defaultAllowedTools);

    // Remove globally blocked
    for (const blocked of this.defaultBlockedTools) {
      result.delete(blocked);
    }

    if (config) {
      // Add goal-specific allowed
      for (const tool of config.allowedTools) {
        result.add(tool);
      }

      // Remove goal-specific blocked
      for (const blocked of config.blockedTools) {
        result.delete(blocked);
      }
    }

    return Array.from(result);
  }

  /**
   * Get blocked tools for a goal
   */
  getBlockedTools(goalId: string): string[] {
    const config = this.goalConfigs.get(goalId);
    const result = new Set(this.defaultBlockedTools);

    if (config) {
      for (const blocked of config.blockedTools) {
        result.add(blocked);
      }
    }

    return Array.from(result);
  }

  /**
   * Filter a list of tools to only those allowed for a goal
   */
  filterAllowed(toolNames: string[], goalId: string): string[] {
    return toolNames.filter(name => this.isAllowed(name, goalId));
  }

  // ============================================================================
  // Default Allowlist Management
  // ============================================================================

  /**
   * Add a tool to the default allowed list
   */
  addDefaultAllowed(toolName: string): void {
    this.defaultAllowedTools.add(toolName);
    this.defaultBlockedTools.delete(toolName);
  }

  /**
   * Remove a tool from the default allowed list
   */
  removeDefaultAllowed(toolName: string): void {
    this.defaultAllowedTools.delete(toolName);
  }

  /**
   * Add a tool to the default blocked list
   */
  addDefaultBlocked(toolName: string): void {
    this.defaultBlockedTools.add(toolName);
    this.defaultAllowedTools.delete(toolName);
  }

  /**
   * Remove a tool from the default blocked list
   */
  removeDefaultBlocked(toolName: string): void {
    this.defaultBlockedTools.delete(toolName);
  }

  /**
   * Get all default allowed tools
   */
  getDefaultAllowedTools(): string[] {
    return Array.from(this.defaultAllowedTools);
  }

  /**
   * Get all default blocked tools
   */
  getDefaultBlockedTools(): string[] {
    return Array.from(this.defaultBlockedTools);
  }

  // ============================================================================
  // Change History
  // ============================================================================

  private recordChange(change: IToolAllowlistChange): void {
    this.changeHistory.push(change);

    // Keep history bounded (last 1000 changes)
    if (this.changeHistory.length > 1000) {
      this.changeHistory = this.changeHistory.slice(-1000);
    }
  }

  /**
   * Get change history for a goal
   */
  getChangeHistory(goalId?: string, limit: number = 100): IToolAllowlistChange[] {
    let history = this.changeHistory;

    if (goalId) {
      history = history.filter(c => c.goalId === goalId);
    }

    return history.slice(-limit);
  }

  /**
   * Clear change history
   */
  clearChangeHistory(): void {
    this.changeHistory = [];
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  /**
   * Export configuration for persistence
   */
  exportConfig(): {
    defaultAllowed: string[];
    defaultBlocked: string[];
    goalConfigs: Array<{
      goalId: string;
      allowedTools: string[];
      blockedTools: string[];
      toolLayers: Array<[string, ResponsibilityLayer]>;
      parentGoalId?: string;
    }>;
  } {
    return {
      defaultAllowed: Array.from(this.defaultAllowedTools),
      defaultBlocked: Array.from(this.defaultBlockedTools),
      goalConfigs: Array.from(this.goalConfigs.values()).map(config => ({
        goalId: config.goalId,
        allowedTools: Array.from(config.allowedTools),
        blockedTools: Array.from(config.blockedTools),
        toolLayers: Array.from(config.toolLayers.entries()),
        parentGoalId: config.parentGoalId,
      })),
    };
  }

  /**
   * Import configuration from persistence
   */
  importConfig(data: ReturnType<GoalScopedAllowlist['exportConfig']>): void {
    this.defaultAllowedTools = new Set(data.defaultAllowed);
    this.defaultBlockedTools = new Set(data.defaultBlocked);
    this.goalConfigs.clear();

    for (const configData of data.goalConfigs) {
      const config: IGoalToolConfig = {
        goalId: configData.goalId,
        allowedTools: new Set(configData.allowedTools),
        blockedTools: new Set(configData.blockedTools),
        toolLayers: new Map(configData.toolLayers),
        parentGoalId: configData.parentGoalId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.goalConfigs.set(config.goalId, config);
    }
  }
}
