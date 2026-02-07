/**
 * OS Service Types
 *
 * Defines types for operating system service permissions.
 * These services require explicit user approval before access.
 */

// ============================================================================
// OS Service Types
// ============================================================================

export type OSService =
  | 'keychain'       // System keychain/credential store (macOS Keychain, Windows Credential Manager)
  | 'browser'        // Browser automation (Puppeteer, Playwright)
  | 'docker'         // Docker daemon access
  | 'network'        // Network access to specific domains/ports
  | 'filesystem'     // Access to sensitive filesystem paths
  | 'clipboard'      // Clipboard read/write
  | 'notifications'  // System notifications
  | 'process'        // Process management (spawn, kill)
  | 'environment';   // Environment variable access

// ============================================================================
// OS Service Permission
// ============================================================================

export type OSPermissionStatus =
  | 'pending'    // Request is pending user approval
  | 'granted'    // Permission has been granted
  | 'denied'     // Permission was denied
  | 'expired';   // Permission grant has expired

export interface IOSServicePermission {
  id: string;
  service: OSService;
  scope: string;           // Specific scope (e.g., domain for network, path for filesystem)
  goal_id: string;
  status: OSPermissionStatus;
  requested_at: number;
  resolved_at?: number;
  resolved_by?: string;
  expires_at?: number;
  reason: string;          // Why the permission is needed
  metadata?: Record<string, unknown>;
}

// ============================================================================
// OS Service Permission Request
// ============================================================================

export interface IOSPermissionRequest {
  id: string;
  service: OSService;
  scope: string;
  goal_id: string;
  work_item_id?: string;
  run_id?: string;
  reason: string;
  requested_at: number;
  expires_at: number;
  status: OSPermissionStatus;
  resolved_at?: number;
  resolved_by?: string;
  resolution_note?: string;
}

// ============================================================================
// Service-Specific Scope Types
// ============================================================================

export interface KeychainScope {
  type: 'read' | 'write' | 'delete';
  service?: string;        // Specific service name in keychain
  account?: string;        // Specific account
}

export interface BrowserScope {
  type: 'launch' | 'navigate' | 'screenshot' | 'automation';
  headless?: boolean;
  allowedDomains?: string[];
}

export interface DockerScope {
  type: 'run' | 'build' | 'exec' | 'logs' | 'stop' | 'remove';
  image?: string;
  container?: string;
}

export interface NetworkScope {
  type: 'http' | 'https' | 'tcp' | 'udp';
  host: string;
  port?: number;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
}

export interface FilesystemScope {
  type: 'read' | 'write' | 'delete' | 'execute';
  path: string;
  recursive?: boolean;
}

export interface ProcessScope {
  type: 'spawn' | 'kill' | 'signal';
  command?: string;
  pid?: number;
}

export type ServiceScope =
  | { service: 'keychain'; scope: KeychainScope }
  | { service: 'browser'; scope: BrowserScope }
  | { service: 'docker'; scope: DockerScope }
  | { service: 'network'; scope: NetworkScope }
  | { service: 'filesystem'; scope: FilesystemScope }
  | { service: 'process'; scope: ProcessScope }
  | { service: 'clipboard'; scope: { type: 'read' | 'write' } }
  | { service: 'notifications'; scope: { type: 'send' } }
  | { service: 'environment'; scope: { type: 'read' | 'write'; keys?: string[] } };

// ============================================================================
// OS Service Checker Interface
// ============================================================================

export interface IOSServiceChecker {
  /**
   * Check if a service permission is granted
   */
  checkPermission(
    service: OSService,
    scope: string,
    goalId: string
  ): Promise<{
    granted: boolean;
    cached: boolean;
    expiresAt?: number;
  }>;

  /**
   * Request permission for an OS service
   * Returns the permission request ID
   */
  requestPermission(params: {
    service: OSService;
    scope: string;
    goalId: string;
    workItemId?: string;
    runId?: string;
    reason: string;
  }): Promise<string>;

  /**
   * Grant a permission request
   */
  grantPermission(
    requestId: string,
    grantedBy: string,
    expiresInMs?: number
  ): Promise<void>;

  /**
   * Deny a permission request
   */
  denyPermission(
    requestId: string,
    deniedBy: string,
    reason?: string
  ): Promise<void>;

  /**
   * Revoke a granted permission
   */
  revokePermission(
    service: OSService,
    scope: string,
    goalId: string
  ): Promise<boolean>;

  /**
   * Revoke all permissions for a goal
   */
  revokeAllForGoal(goalId: string): Promise<number>;

  /**
   * List active permissions for a goal
   */
  listActivePermissions(goalId: string): Promise<IOSServicePermission[]>;

  /**
   * List pending permission requests
   */
  listPendingRequests(goalId?: string): Promise<IOSPermissionRequest[]>;

  /**
   * Check if a service is available on the current system
   */
  isServiceAvailable(service: OSService): Promise<boolean>;
}

// ============================================================================
// Sensitive Paths (require filesystem permission)
// ============================================================================

export const SENSITIVE_PATHS = [
  // Unix/Linux/macOS
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/ssh/',
  '~/.ssh/',
  '~/.gnupg/',
  '~/.aws/',
  '~/.config/gcloud/',
  '~/.kube/',
  '~/.docker/',
  // Environment files
  '.env',
  '.env.local',
  '.env.production',
  // Credential files
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'service-account.json',
];

// ============================================================================
// Database Row Types
// ============================================================================

export interface OSPermissionRequestRow {
  id: string;
  service: string;
  scope: string;
  goal_id: string;
  work_item_id: string | null;
  run_id: string | null;
  reason: string;
  requested_at: number;
  expires_at: number;
  status: string;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface OSPermissionGrantRow {
  id: string;
  service: string;
  scope: string;
  goal_id: string;
  granted_at: number;
  expires_at: number;
  granted_by: string;
  metadata: string | null;
}
