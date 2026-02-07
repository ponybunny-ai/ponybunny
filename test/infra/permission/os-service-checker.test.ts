import Database from 'better-sqlite3';
import { OSPermissionRepository, OSServiceChecker } from '../../../src/infra/permission/os-service-checker.js';
import type { OSService } from '../../../src/domain/permission/os-service.js';

describe('OSPermissionRepository', () => {
  let db: Database.Database;
  let repository: OSPermissionRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    repository = new OSPermissionRepository(db);
    repository.initialize();
  });

  afterEach(() => {
    db.close();
  });

  describe('createRequest', () => {
    it('should create a permission request', () => {
      const request = repository.createRequest({
        service: 'docker',
        scope: 'run:nginx',
        goal_id: 'goal-1',
        reason: 'Need to run nginx container for testing',
        expires_at: Date.now() + 30 * 60 * 1000,
      });

      expect(request.id).toBeDefined();
      expect(request.service).toBe('docker');
      expect(request.scope).toBe('run:nginx');
      expect(request.status).toBe('pending');
    });
  });

  describe('createGrant', () => {
    it('should create a permission grant', () => {
      const grant = repository.createGrant({
        service: 'network',
        scope: 'https://api.example.com',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      expect(grant.id).toBeDefined();
      expect(grant.service).toBe('network');
      expect(grant.status).toBe('granted');
    });

    it('should allow checking grant', () => {
      repository.createGrant({
        service: 'filesystem',
        scope: '/tmp/workspace',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      const grant = repository.getGrant('filesystem', '/tmp/workspace', 'goal-1');
      expect(grant).toBeDefined();
      expect(grant!.service).toBe('filesystem');
    });
  });

  describe('revokeGrant', () => {
    it('should revoke a grant', () => {
      repository.createGrant({
        service: 'docker',
        scope: 'run:*',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      const revoked = repository.revokeGrant('docker', 'run:*', 'goal-1');
      expect(revoked).toBe(true);

      const grant = repository.getGrant('docker', 'run:*', 'goal-1');
      expect(grant).toBeUndefined();
    });
  });

  describe('revokeAllForGoal', () => {
    it('should revoke all grants for a goal', () => {
      repository.createGrant({
        service: 'docker',
        scope: 'run:*',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      repository.createGrant({
        service: 'network',
        scope: 'https://*',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      const revoked = repository.revokeAllForGoal('goal-1');
      expect(revoked).toBe(2);

      const grants = repository.getActiveGrants('goal-1');
      expect(grants).toHaveLength(0);
    });
  });
});

describe('OSServiceChecker', () => {
  let db: Database.Database;
  let repository: OSPermissionRepository;
  let checker: OSServiceChecker;

  beforeEach(() => {
    db = new Database(':memory:');
    repository = new OSPermissionRepository(db);
    repository.initialize();
    checker = new OSServiceChecker(repository);
  });

  afterEach(() => {
    db.close();
  });

  describe('checkPermission', () => {
    it('should return false for non-granted permission', async () => {
      const result = await checker.checkPermission('docker', 'run:nginx', 'goal-1');
      expect(result.granted).toBe(false);
      expect(result.cached).toBe(false);
    });

    it('should return true for granted permission', async () => {
      // Create a grant directly
      repository.createGrant({
        service: 'docker',
        scope: 'run:nginx',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      const result = await checker.checkPermission('docker', 'run:nginx', 'goal-1');
      expect(result.granted).toBe(true);
    });

    it('should use cache on second check', async () => {
      repository.createGrant({
        service: 'network',
        scope: 'https://api.example.com',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      // First check - from database
      const result1 = await checker.checkPermission('network', 'https://api.example.com', 'goal-1');
      expect(result1.granted).toBe(true);
      expect(result1.cached).toBe(false);

      // Second check - from cache
      const result2 = await checker.checkPermission('network', 'https://api.example.com', 'goal-1');
      expect(result2.granted).toBe(true);
      expect(result2.cached).toBe(true);
    });
  });

  describe('requestPermission', () => {
    it('should create a pending request', async () => {
      const requestId = await checker.requestPermission({
        service: 'keychain',
        scope: 'read:my-service',
        goalId: 'goal-1',
        reason: 'Need to read API key from keychain',
      });

      expect(requestId).toBeDefined();

      const requests = await checker.listPendingRequests('goal-1');
      expect(requests).toHaveLength(1);
      expect(requests[0].service).toBe('keychain');
    });
  });

  describe('grantPermission', () => {
    it('should grant a pending request', async () => {
      const requestId = await checker.requestPermission({
        service: 'browser',
        scope: 'launch:headless',
        goalId: 'goal-1',
        reason: 'Need to take screenshots',
      });

      await checker.grantPermission(requestId, 'user-123');

      const result = await checker.checkPermission('browser', 'launch:headless', 'goal-1');
      expect(result.granted).toBe(true);
    });

    it('should throw for non-existent request', async () => {
      await expect(
        checker.grantPermission('non-existent', 'user-123')
      ).rejects.toThrow('not found');
    });
  });

  describe('denyPermission', () => {
    it('should deny a pending request', async () => {
      const requestId = await checker.requestPermission({
        service: 'process',
        scope: 'kill:*',
        goalId: 'goal-1',
        reason: 'Need to kill stale processes',
      });

      await checker.denyPermission(requestId, 'user-123', 'Too dangerous');

      const requests = await checker.listPendingRequests('goal-1');
      expect(requests).toHaveLength(0);

      const result = await checker.checkPermission('process', 'kill:*', 'goal-1');
      expect(result.granted).toBe(false);
    });
  });

  describe('revokeAllForGoal', () => {
    it('should revoke all permissions and clear cache', async () => {
      // Grant some permissions
      repository.createGrant({
        service: 'docker',
        scope: 'run:*',
        goalId: 'goal-1',
        grantedBy: 'user-123',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });

      // Check to populate cache
      await checker.checkPermission('docker', 'run:*', 'goal-1');

      // Revoke all
      const revoked = await checker.revokeAllForGoal('goal-1');
      expect(revoked).toBe(1);

      // Verify revoked
      const result = await checker.checkPermission('docker', 'run:*', 'goal-1');
      expect(result.granted).toBe(false);
    });
  });

  describe('isServiceAvailable', () => {
    it('should return true for always-available services', async () => {
      expect(await checker.isServiceAvailable('network')).toBe(true);
      expect(await checker.isServiceAvailable('filesystem')).toBe(true);
      expect(await checker.isServiceAvailable('environment')).toBe(true);
      expect(await checker.isServiceAvailable('process')).toBe(true);
    });
  });
});
