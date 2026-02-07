/**
 * Permission Domain Types
 *
 * Implements the three-layer responsibility model:
 * - Layer 1 (Autonomous): Safe operations, no approval needed
 * - Layer 2 (Approval Required): Risky operations, need user approval
 * - Layer 3 (Forbidden): Dangerous operations, always blocked
 */

// ============================================================================
// Responsibility Layers
// ============================================================================

export type ResponsibilityLayer =
  | 'autonomous'        // Layer 1: Can execute without approval
  | 'approval_required' // Layer 2: Needs user approval before execution
  | 'forbidden';        // Layer 3: Never allowed, always blocked

// ============================================================================
// Tool Categories
// ============================================================================

export type ToolCategory =
  | 'filesystem'  // File read/write operations
  | 'shell'       // Command execution
  | 'network'     // HTTP requests, web operations
  | 'database'    // Database operations
  | 'git'         // Version control operations
  | 'code'        // Code analysis, search
  | 'browser'     // Browser automation
  | 'system';     // System-level operations

// ============================================================================
// Risk Levels
// ============================================================================

export type RiskLevel = 'safe' | 'moderate' | 'dangerous' | 'critical';

// ============================================================================
// Permission Request
// ============================================================================

export type PermissionRequestStatus =
  | 'pending'   // Waiting for user decision
  | 'approved'  // User approved the request
  | 'denied'    // User denied the request
  | 'expired';  // Request expired without decision

export interface IPermissionRequest {
  id: string;
  created_at: number;
  expires_at: number;

  // Tool information
  tool_name: string;
  layer: 'approval_required';

  // Context
  goal_id: string;
  work_item_id?: string;
  run_id?: string;

  // Request details
  reason: string;
  args_summary: string;  // Sanitized summary of arguments

  // Status
  status: PermissionRequestStatus;

  // Resolution (when approved/denied)
  resolved_at?: number;
  resolved_by?: string;
  resolution_note?: string;
}

// ============================================================================
// Permission Cache
// ============================================================================

export interface IPermissionGrant {
  tool_name: string;
  goal_id: string;
  granted_at: number;
  expires_at: number;
  granted_by: string;
  scope?: string;  // Optional scope limitation
}

// ============================================================================
// Forbidden Operation Pattern
// ============================================================================

export interface IForbiddenPattern {
  id: string;
  pattern: RegExp;
  description: string;
  category: ToolCategory;
  severity: 'high' | 'critical';
  examples?: string[];
}

// ============================================================================
// Tool Definition (Enhanced)
// ============================================================================

export interface IEnhancedToolDefinition {
  name: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  layer: ResponsibilityLayer;
  description: string;

  // Permission requirements
  permissions?: {
    os_services?: OSService[];
    requires_sudo?: boolean;
    network_access?: boolean;
    sensitive_data?: boolean;
  };

  // Argument validation schema
  argsSchema?: Record<string, IArgSchema>;

  // Forbidden patterns specific to this tool
  forbiddenPatterns?: IForbiddenPattern[];
}

export interface IArgSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  pattern?: string;      // Regex pattern for validation
  enum?: unknown[];      // Allowed values
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  description?: string;
}

// ============================================================================
// OS Service Types
// ============================================================================

export type OSService =
  | 'keychain'       // System keychain/credential store
  | 'browser'        // Browser automation
  | 'docker'         // Docker daemon
  | 'network'        // Network access
  | 'filesystem'     // Filesystem access
  | 'clipboard'      // Clipboard access
  | 'notifications'  // System notifications
  | 'camera'         // Camera access
  | 'microphone';    // Microphone access

// ============================================================================
// Enforcement Result
// ============================================================================

export interface IEnforcementResult {
  allowed: boolean;
  layer: ResponsibilityLayer;
  reason?: string;

  // For Layer 2 operations
  requires_approval?: boolean;
  permission_request_id?: string;

  // For forbidden operations
  forbidden_pattern?: IForbiddenPattern;
}

// ============================================================================
// Permission Repository Interface
// ============================================================================

export interface IPermissionRepository {
  // Permission requests
  createRequest(params: Omit<IPermissionRequest, 'id' | 'created_at' | 'status'>): IPermissionRequest;
  getRequest(id: string): IPermissionRequest | undefined;
  getPendingRequests(goalId?: string): IPermissionRequest[];
  resolveRequest(id: string, status: 'approved' | 'denied', resolvedBy: string, note?: string): void;
  expireOldRequests(): number;

  // Permission grants (cache)
  grantPermission(grant: Omit<IPermissionGrant, 'granted_at'>): IPermissionGrant;
  getGrant(toolName: string, goalId: string): IPermissionGrant | undefined;
  revokeGrant(toolName: string, goalId: string): boolean;
  revokeAllForGoal(goalId: string): number;
  cleanupExpiredGrants(): number;
}

// ============================================================================
// Permission Service Interface
// ============================================================================

export interface IPermissionService {
  /**
   * Check if a tool operation is allowed
   */
  checkPermission(
    toolName: string,
    args: Record<string, unknown>,
    context: { goalId: string; workItemId?: string; runId?: string }
  ): Promise<IEnforcementResult>;

  /**
   * Request permission for a Layer 2 operation
   */
  requestPermission(params: {
    toolName: string;
    args: Record<string, unknown>;
    goalId: string;
    workItemId?: string;
    runId?: string;
    reason: string;
  }): Promise<string>;  // Returns permission_request_id

  /**
   * Approve a permission request
   */
  approveRequest(requestId: string, approvedBy: string, note?: string): Promise<void>;

  /**
   * Deny a permission request
   */
  denyRequest(requestId: string, deniedBy: string, reason?: string): Promise<void>;

  /**
   * Check if a permission is cached/granted
   */
  hasGrantedPermission(toolName: string, goalId: string): boolean;

  /**
   * Revoke all permissions for a goal (e.g., when goal completes)
   */
  revokeAllForGoal(goalId: string): void;
}

// ============================================================================
// Layer Classification Rules
// ============================================================================

/**
 * Default layer classification based on tool properties
 */
export function getDefaultLayer(
  category: ToolCategory,
  riskLevel: RiskLevel
): ResponsibilityLayer {
  // Critical risk is always forbidden
  if (riskLevel === 'critical') {
    return 'forbidden';
  }

  // Dangerous operations require approval
  if (riskLevel === 'dangerous') {
    return 'approval_required';
  }

  // Category-based rules for moderate risk
  if (riskLevel === 'moderate') {
    switch (category) {
      case 'shell':
      case 'system':
      case 'database':
        return 'approval_required';
      default:
        return 'autonomous';
    }
  }

  // Safe operations are autonomous
  return 'autonomous';
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface PermissionRequestRow {
  id: string;
  created_at: number;
  expires_at: number;
  tool_name: string;
  layer: string;
  goal_id: string;
  work_item_id: string | null;
  run_id: string | null;
  reason: string;
  args_summary: string;
  status: string;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface PermissionGrantRow {
  tool_name: string;
  goal_id: string;
  granted_at: number;
  expires_at: number;
  granted_by: string;
  scope: string | null;
}
