/**
 * Enhanced Tool Enforcer
 *
 * Implements the three-layer responsibility model:
 * - Layer 1 (Autonomous): Execute without approval
 * - Layer 2 (Approval Required): Pause and request permission
 * - Layer 3 (Forbidden): Block and log
 */

import type {
  ResponsibilityLayer,
  IEnforcementResult,
  IForbiddenPattern,
  IPermissionGrant,
} from '../../domain/permission/types.js';
import type { ToolRegistry, ToolDefinition } from './tool-registry.js';
import { checkForbiddenPatterns, ALL_FORBIDDEN_PATTERNS } from './forbidden-patterns.js';

/**
 * Tool layer configuration
 * Maps tool names to their responsibility layers
 */
export interface ToolLayerConfig {
  // Override default layer for specific tools
  overrides: Map<string, ResponsibilityLayer>;

  // Default layer for unknown tools
  defaultLayer: ResponsibilityLayer;

  // Permission grant cache
  grants: Map<string, IPermissionGrant>;
}

/**
 * Enhanced Tool Enforcer with three-layer responsibility model
 */
export class EnhancedToolEnforcer {
  private layerConfig: ToolLayerConfig;

  constructor(
    private registry: ToolRegistry,
    config?: Partial<ToolLayerConfig>
  ) {
    this.layerConfig = {
      overrides: config?.overrides ?? new Map(),
      defaultLayer: config?.defaultLayer ?? 'approval_required',
      grants: config?.grants ?? new Map(),
    };

    // Set up default layer overrides based on tool properties
    this.initializeDefaultLayers();
  }

  /**
   * Initialize default layer assignments based on tool properties
   */
  private initializeDefaultLayers(): void {
    const tools = this.registry.getAllTools();

    for (const tool of tools) {
      if (!this.layerConfig.overrides.has(tool.name)) {
        const layer = this.determineLayer(tool);
        this.layerConfig.overrides.set(tool.name, layer);
      }
    }
  }

  /**
   * Determine the responsibility layer for a tool based on its properties
   */
  private determineLayer(tool: ToolDefinition): ResponsibilityLayer {
    // Critical/dangerous shell commands are forbidden by default
    if (tool.category === 'shell' && tool.riskLevel === 'dangerous') {
      return 'approval_required';
    }

    // Safe read-only operations are autonomous
    if (tool.riskLevel === 'safe') {
      return 'autonomous';
    }

    // Moderate risk operations
    if (tool.riskLevel === 'moderate') {
      // File writes require approval
      if (tool.category === 'filesystem' && tool.name.includes('write')) {
        return 'approval_required';
      }
      // Network operations are autonomous (but can be overridden)
      if (tool.category === 'network') {
        return 'autonomous';
      }
      return 'autonomous';
    }

    // Dangerous operations require approval
    if (tool.riskLevel === 'dangerous') {
      return 'approval_required';
    }

    // Default to requiring approval for unknown cases
    return 'approval_required';
  }

  /**
   * Get the responsibility layer for a tool
   */
  getToolLayer(toolName: string): ResponsibilityLayer {
    return this.layerConfig.overrides.get(toolName) ?? this.layerConfig.defaultLayer;
  }

  /**
   * Set the responsibility layer for a tool
   */
  setToolLayer(toolName: string, layer: ResponsibilityLayer): void {
    this.layerConfig.overrides.set(toolName, layer);
  }

  /**
   * Check if a tool invocation is allowed
   */
  checkInvocation(
    toolName: string,
    args: Record<string, unknown>,
    context: { goalId: string }
  ): IEnforcementResult {
    // 1. Check if tool exists
    const tool = this.registry.getTool(toolName);
    if (!tool) {
      return {
        allowed: false,
        layer: 'forbidden',
        reason: `Tool '${toolName}' not found in registry`,
      };
    }

    // 2. Check for forbidden patterns in arguments
    const forbiddenCheck = this.checkForbiddenPatterns(toolName, args, tool.category);
    if (forbiddenCheck) {
      return {
        allowed: false,
        layer: 'forbidden',
        reason: `Forbidden operation detected: ${forbiddenCheck.description}`,
        forbidden_pattern: forbiddenCheck,
      };
    }

    // 3. Get the tool's responsibility layer
    const layer = this.getToolLayer(toolName);

    // 4. Handle based on layer
    switch (layer) {
      case 'autonomous':
        return {
          allowed: true,
          layer: 'autonomous',
        };

      case 'approval_required':
        // Check if we have a cached permission grant
        const grantKey = `${context.goalId}:${toolName}`;
        const grant = this.layerConfig.grants.get(grantKey);

        if (grant && grant.expires_at > Date.now()) {
          // Permission is cached and valid
          return {
            allowed: true,
            layer: 'approval_required',
            requires_approval: false,
          };
        }

        // Need to request approval
        return {
          allowed: false,
          layer: 'approval_required',
          requires_approval: true,
          reason: `Tool '${toolName}' requires approval before execution`,
        };

      case 'forbidden':
        return {
          allowed: false,
          layer: 'forbidden',
          reason: `Tool '${toolName}' is forbidden`,
        };

      default:
        return {
          allowed: false,
          layer: 'forbidden',
          reason: `Unknown layer '${layer}' for tool '${toolName}'`,
        };
    }
  }

  /**
   * Check arguments against forbidden patterns
   */
  private checkForbiddenPatterns(
    toolName: string,
    args: Record<string, unknown>,
    category: string
  ): IForbiddenPattern | null {
    const result = checkForbiddenPatterns(args, category);
    if (result.forbidden && result.pattern) {
      return result.pattern;
    }
    return null;
  }

  /**
   * Grant permission for a tool in a goal context
   */
  grantPermission(
    toolName: string,
    goalId: string,
    grantedBy: string,
    expiresInMs: number = 30 * 60 * 1000 // 30 minutes default
  ): IPermissionGrant {
    const grant: IPermissionGrant = {
      tool_name: toolName,
      goal_id: goalId,
      granted_at: Date.now(),
      expires_at: Date.now() + expiresInMs,
      granted_by: grantedBy,
    };

    const grantKey = `${goalId}:${toolName}`;
    this.layerConfig.grants.set(grantKey, grant);

    return grant;
  }

  /**
   * Revoke permission for a tool in a goal context
   */
  revokePermission(toolName: string, goalId: string): boolean {
    const grantKey = `${goalId}:${toolName}`;
    return this.layerConfig.grants.delete(grantKey);
  }

  /**
   * Revoke all permissions for a goal
   */
  revokeAllForGoal(goalId: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of this.layerConfig.grants.keys()) {
      if (key.startsWith(`${goalId}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.layerConfig.grants.delete(key);
      count++;
    }

    return count;
  }

  /**
   * Clean up expired permission grants
   */
  cleanupExpiredGrants(): number {
    const now = Date.now();
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key, grant] of this.layerConfig.grants.entries()) {
      if (grant.expires_at < now) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.layerConfig.grants.delete(key);
      count++;
    }

    return count;
  }

  /**
   * Get all tools by layer
   */
  getToolsByLayer(layer: ResponsibilityLayer): string[] {
    const result: string[] = [];
    for (const [toolName, toolLayer] of this.layerConfig.overrides.entries()) {
      if (toolLayer === layer) {
        result.push(toolName);
      }
    }
    return result;
  }

  /**
   * Get layer configuration summary
   */
  getLayerSummary(): Record<ResponsibilityLayer, string[]> {
    return {
      autonomous: this.getToolsByLayer('autonomous'),
      approval_required: this.getToolsByLayer('approval_required'),
      forbidden: this.getToolsByLayer('forbidden'),
    };
  }

  /**
   * Check if a tool has a cached permission grant
   */
  hasPermissionGrant(toolName: string, goalId: string): boolean {
    const grantKey = `${goalId}:${toolName}`;
    const grant = this.layerConfig.grants.get(grantKey);
    return grant !== undefined && grant.expires_at > Date.now();
  }
}

/**
 * Default tool layer assignments
 */
export const DEFAULT_TOOL_LAYERS: Record<string, ResponsibilityLayer> = {
  // Autonomous (Layer 1) - Safe read-only operations
  read_file: 'autonomous',
  search_code: 'autonomous',
  web_search: 'autonomous',
  list_directory: 'autonomous',
  get_file_info: 'autonomous',

  // Approval Required (Layer 2) - Operations with side effects
  write_file: 'approval_required',
  execute_command: 'approval_required',
  delete_file: 'approval_required',
  git_commit: 'approval_required',
  git_push: 'approval_required',
  http_request: 'approval_required',
  database_query: 'approval_required',

  // Forbidden (Layer 3) - Never allowed (handled by patterns, not tool names)
};
