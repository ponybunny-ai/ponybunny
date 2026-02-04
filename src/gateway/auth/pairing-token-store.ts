/**
 * Pairing Token Store - Manages pairing tokens in SQLite
 */

import { createHash, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import type { Permission, PairingToken } from '../types.js';

export interface PairingTokenRow {
  id: string;
  token_hash: string;
  public_key: string | null;
  permissions: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}

export class PairingTokenStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Generate a new pairing token
   * @returns The plaintext token (only returned once, store securely)
   */
  createToken(permissions: Permission[], expiresInMs?: number): { token: string; id: string } {
    const id = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const now = Date.now();
    const expiresAt = expiresInMs ? now + expiresInMs : null;

    const stmt = this.db.prepare(`
      INSERT INTO pairing_tokens (id, token_hash, permissions, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, tokenHash, JSON.stringify(permissions), now, expiresAt);

    return { token, id };
  }

  /**
   * Validate a token and return its data if valid
   */
  validateToken(token: string): PairingToken | null {
    const tokenHash = this.hashToken(token);
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT * FROM pairing_tokens
      WHERE token_hash = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `);

    const row = stmt.get(tokenHash, now) as PairingTokenRow | undefined;
    if (!row) return null;

    return this.rowToToken(row);
  }

  /**
   * Bind a public key to a token (completes pairing)
   */
  bindPublicKey(tokenId: string, publicKey: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE pairing_tokens
      SET public_key = ?
      WHERE id = ?
        AND public_key IS NULL
        AND revoked_at IS NULL
    `);

    const result = stmt.run(publicKey, tokenId);
    return result.changes > 0;
  }

  /**
   * Get token by public key (for returning clients)
   */
  getByPublicKey(publicKey: string): PairingToken | null {
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT * FROM pairing_tokens
      WHERE public_key = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `);

    const row = stmt.get(publicKey, now) as PairingTokenRow | undefined;
    if (!row) return null;

    return this.rowToToken(row);
  }

  /**
   * Revoke a token
   */
  revokeToken(tokenId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE pairing_tokens
      SET revoked_at = ?
      WHERE id = ?
        AND revoked_at IS NULL
    `);

    const result = stmt.run(Date.now(), tokenId);
    return result.changes > 0;
  }

  /**
   * Revoke all tokens for a public key
   */
  revokeByPublicKey(publicKey: string): number {
    const stmt = this.db.prepare(`
      UPDATE pairing_tokens
      SET revoked_at = ?
      WHERE public_key = ?
        AND revoked_at IS NULL
    `);

    const result = stmt.run(Date.now(), publicKey);
    return result.changes;
  }

  /**
   * List all active tokens
   */
  listActiveTokens(): PairingToken[] {
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT * FROM pairing_tokens
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(now) as PairingTokenRow[];
    return rows.map(row => this.rowToToken(row));
  }

  /**
   * Clean up expired tokens
   */
  cleanupExpired(): number {
    const now = Date.now();

    const stmt = this.db.prepare(`
      DELETE FROM pairing_tokens
      WHERE expires_at IS NOT NULL
        AND expires_at < ?
    `);

    const result = stmt.run(now);
    return result.changes;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private rowToToken(row: PairingTokenRow): PairingToken {
    return {
      id: row.id,
      tokenHash: row.token_hash,
      publicKey: row.public_key ?? undefined,
      permissions: JSON.parse(row.permissions) as Permission[],
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
    };
  }
}
