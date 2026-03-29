import {
  resolveLocalPermissions,
  DEFAULT_GATEWAY_AUTH_CONFIG,
} from '../../../src/gateway/auth/auth-config.js';
import type { GatewayAuthConfig } from '../../../src/gateway/auth/auth-config.js';

describe('GatewayAuthConfig', () => {
  describe('resolveLocalPermissions', () => {
    it('returns full permissions for admin policy', () => {
      const perms = resolveLocalPermissions({ localConnectionPolicy: 'admin' });
      expect(perms).toEqual(['read', 'write', 'admin']);
    });

    it('returns read-only for read policy', () => {
      const perms = resolveLocalPermissions({ localConnectionPolicy: 'read' });
      expect(perms).toEqual(['read']);
    });

    it('returns null for none policy (require auth)', () => {
      const perms = resolveLocalPermissions({ localConnectionPolicy: 'none' });
      expect(perms).toBeNull();
    });
  });

  describe('DEFAULT_GATEWAY_AUTH_CONFIG', () => {
    it('defaults to admin for backward compatibility', () => {
      expect(DEFAULT_GATEWAY_AUTH_CONFIG.localConnectionPolicy).toBe('admin');
    });
  });
});
