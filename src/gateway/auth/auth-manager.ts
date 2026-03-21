/**
 * Auth Manager - Orchestrates the triple-check authentication flow
 *
 * Authentication Flow:
 * 1. Client connects and sends auth.hello with public key
 * 2. Server checks if public key is known (has paired token)
 * 3. If known: Server sends challenge
 * 4. Client signs challenge and sends auth.verify
 * 5. Server verifies signature and creates session
 *
 * For new clients:
 * 1. Client sends auth.pair with pairing token
 * 2. Server validates token and sends challenge
 * 3. Client signs challenge and sends auth.verify with public key
 * 4. Server binds public key to token and creates session
 */

import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import { ChallengeGenerator } from './challenge-generator.js';
import { SignatureVerifier } from './signature-verifier.js';
import { PairingTokenStore } from './pairing-token-store.js';
import type { SessionData, Permission, AuthResult } from '../types.js';
import { GatewayError, ErrorCodes } from '../errors.js';

export interface AuthManagerConfig {
  challengeTtlMs: number;
  /** Maximum auth attempts per connection within the rate-limit window */
  maxAuthAttemptsPerWindow: number;
  /** Rate-limit window duration in milliseconds */
  rateLimitWindowMs: number;
}

const DEFAULT_CONFIG: AuthManagerConfig = {
  challengeTtlMs: 60000,
  maxAuthAttemptsPerWindow: 10,
  rateLimitWindowMs: 60000,
};

interface PendingAuth {
  connectionId: string;
  publicKey?: string;
  tokenId?: string;
  permissions?: Permission[];
  challenge: string;
  expiresAt: number;
}

export class AuthManager {
  private challengeGenerator: ChallengeGenerator;
  private signatureVerifier: SignatureVerifier;
  private tokenStore: PairingTokenStore;
  private pendingAuths = new Map<string, PendingAuth>();
  private authAttempts = new Map<string, number[]>();
  private config: AuthManagerConfig;

  constructor(db: Database.Database, config: Partial<AuthManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.challengeGenerator = new ChallengeGenerator({
      challengeTtlMs: this.config.challengeTtlMs,
    });
    this.signatureVerifier = new SignatureVerifier();
    this.tokenStore = new PairingTokenStore(db);
  }

  /**
   * Check and record an auth attempt; throws if rate limit exceeded.
   */
  private checkRateLimit(connectionId: string): void {
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindowMs;
    const attempts = (this.authAttempts.get(connectionId) ?? []).filter((t) => t > windowStart);
    attempts.push(now);
    this.authAttempts.set(connectionId, attempts);

    if (attempts.length > this.config.maxAuthAttemptsPerWindow) {
      throw new GatewayError(ErrorCodes.AUTH_FAILED, 'Rate limit exceeded, try again later');
    }
  }

  /**
   * Handle auth.hello - Start authentication for known client
   */
  handleHello(connectionId: string, publicKey: string): { challenge: string } {
    this.checkRateLimit(connectionId);

    if (!this.signatureVerifier.isValidPublicKey(publicKey)) {
      throw GatewayError.invalidParams('Invalid public key format');
    }

    // Check if public key is registered
    const token = this.tokenStore.getByPublicKey(publicKey);
    if (!token) {
      throw new GatewayError(ErrorCodes.AUTH_FAILED, 'Unknown public key. Use auth.pair to register.');
    }

    // Generate challenge
    const { challenge, expiresAt } = this.challengeGenerator.generate(connectionId);

    this.pendingAuths.set(connectionId, {
      connectionId,
      publicKey,
      permissions: token.permissions,
      challenge,
      expiresAt,
    });

    return { challenge };
  }

  /**
   * Handle auth.pair - Start pairing flow for new client
   */
  handlePair(connectionId: string, pairingToken: string): { challenge: string } {
    this.checkRateLimit(connectionId);

    const token = this.tokenStore.validateToken(pairingToken);
    if (!token) {
      throw new GatewayError(ErrorCodes.INVALID_TOKEN, 'Invalid or expired pairing token');
    }

    if (token.publicKey) {
      throw new GatewayError(ErrorCodes.INVALID_TOKEN, 'Token already paired to a device');
    }

    // Generate challenge
    const { challenge, expiresAt } = this.challengeGenerator.generate(connectionId);

    this.pendingAuths.set(connectionId, {
      connectionId,
      tokenId: token.id,
      permissions: token.permissions,
      challenge,
      expiresAt,
    });

    return { challenge };
  }

  /**
   * Handle auth.verify - Complete authentication with signed challenge
   */
  async handleVerify(
    connectionId: string,
    signature: string,
    publicKey?: string
  ): Promise<AuthResult> {
    const pending = this.pendingAuths.get(connectionId);
    if (!pending) {
      throw new GatewayError(ErrorCodes.AUTH_FAILED, 'No pending authentication');
    }

    // Check expiration
    if (Date.now() > pending.expiresAt) {
      this.pendingAuths.delete(connectionId);
      throw new GatewayError(ErrorCodes.CHALLENGE_EXPIRED);
    }

    // Determine public key to use
    const keyToVerify = pending.publicKey || publicKey;
    if (!keyToVerify) {
      throw GatewayError.invalidParams('Public key required for pairing');
    }

    if (!this.signatureVerifier.isValidPublicKey(keyToVerify)) {
      throw GatewayError.invalidParams('Invalid public key format');
    }

    // Verify signature
    const isValid = await this.signatureVerifier.verify(
      pending.challenge,
      signature,
      keyToVerify
    );

    if (!isValid) {
      this.pendingAuths.delete(connectionId);
      throw new GatewayError(ErrorCodes.SIGNATURE_INVALID);
    }

    // If this is a pairing flow, bind the public key
    if (pending.tokenId && publicKey) {
      const bound = this.tokenStore.bindPublicKey(pending.tokenId, publicKey);
      if (!bound) {
        this.pendingAuths.delete(connectionId);
        throw new GatewayError(ErrorCodes.AUTH_FAILED, 'Failed to bind public key');
      }
    }

    // Clean up pending auth
    this.pendingAuths.delete(connectionId);

    // Create session
    const session: SessionData = {
      id: randomBytes(16).toString('hex'),
      publicKey: keyToVerify,
      permissions: pending.permissions || ['read'],
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    return { success: true, session };
  }

  /**
   * Validate a token directly (used for auth.token flow)
   */
  validateToken(token: string) {
    return this.tokenStore.validateToken(token);
  }

  /**
   * Cancel pending authentication
   */
  cancelAuth(connectionId: string): void {
    this.pendingAuths.delete(connectionId);
    this.challengeGenerator.removeChallenge(connectionId);
  }

  /**
   * Create a new pairing token
   */
  createPairingToken(permissions: Permission[], expiresInMs?: number): { token: string; id: string } {
    return this.tokenStore.createToken(permissions, expiresInMs);
  }

  /**
   * Revoke a pairing token
   */
  revokePairingToken(tokenId: string): boolean {
    return this.tokenStore.revokeToken(tokenId);
  }

  /**
   * List active pairing tokens
   */
  listPairingTokens() {
    return this.tokenStore.listActiveTokens();
  }

  /**
   * Check if a public key is registered
   */
  isPublicKeyRegistered(publicKey: string): boolean {
    return this.tokenStore.getByPublicKey(publicKey) !== null;
  }

  /**
   * Get permissions for a public key
   */
  getPermissions(publicKey: string): Permission[] | null {
    const token = this.tokenStore.getByPublicKey(publicKey);
    return token?.permissions ?? null;
  }

  /**
   * Clean up expired tokens and challenges
   */
  cleanup(): void {
    this.tokenStore.cleanupExpired();

    const now = Date.now();
    for (const [id, pending] of this.pendingAuths) {
      if (now > pending.expiresAt) {
        this.pendingAuths.delete(id);
      }
    }

    // Prune stale rate-limit entries
    const windowStart = now - this.config.rateLimitWindowMs;
    for (const [id, attempts] of this.authAttempts) {
      const recent = attempts.filter((t) => t > windowStart);
      if (recent.length === 0) {
        this.authAttempts.delete(id);
      } else {
        this.authAttempts.set(id, recent);
      }
    }
  }
}
