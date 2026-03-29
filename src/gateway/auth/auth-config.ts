/**
 * Gateway Authentication Configuration.
 *
 * Documents and makes configurable the security assumptions around
 * local connection auto-authentication.
 *
 * Security assumption (default 'admin' mode):
 *   Connections from 127.0.0.1 / ::1 are trusted and automatically
 *   granted full admin permissions. This is appropriate for single-user
 *   machines where PonyBunny runs as a local development tool.
 *
 * For Docker, CI, shared-server, or multi-user environments, set
 * localConnectionPolicy to 'none' to require explicit authentication
 * for all connections.
 */

export interface GatewayAuthConfig {
  /**
   * Permission level automatically granted to local connections
   * (127.0.0.1 / ::1).
   *
   * - 'admin': Full permissions without token (default, for dev/personal use)
   * - 'read':  Read-only access for local connections, write requires token
   * - 'none':  No auto-auth; all connections must present a valid token
   */
  localConnectionPolicy: 'admin' | 'read' | 'none';
}

export const DEFAULT_GATEWAY_AUTH_CONFIG: GatewayAuthConfig = {
  localConnectionPolicy: 'admin',
};

/**
 * Resolve permissions for a local connection based on auth config.
 */
export function resolveLocalPermissions(
  config: GatewayAuthConfig
): string[] | null {
  switch (config.localConnectionPolicy) {
    case 'admin':
      return ['read', 'write', 'admin'];
    case 'read':
      return ['read'];
    case 'none':
      return null; // No auto-permissions; must authenticate
  }
}
