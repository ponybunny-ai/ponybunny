/**
 * Key Manager - Manages client keypair for gateway authentication
 *
 * Uses @noble/ed25519 to match the gateway's signature verification format.
 * Keys are stored as raw hex-encoded bytes:
 * - Private key: 32 bytes (64 hex chars)
 * - Public key: 32 bytes (64 hex chars)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { getConfigDir } from '../../infra/config/config-paths.js';

// Configure ed25519 to use sha512
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const PONY_DIR = getConfigDir();
const PRIVATE_KEY_PATH = join(PONY_DIR, 'client.key');
const PUBLIC_KEY_PATH = join(PONY_DIR, 'client.pub');

export interface KeyPair {
  privateKey: string;  // hex-encoded 32 bytes
  publicKey: string;   // hex-encoded 32 bytes
}

function ensurePonyDir(): void {
  if (!existsSync(PONY_DIR)) {
    mkdirSync(PONY_DIR, { recursive: true });
  }
}

/**
 * Generate a new Ed25519 keypair
 * Returns hex-encoded keys matching gateway format
 */
export function generateKeyPair(): KeyPair {
  // Generate 32 random bytes for private key
  const privateKeyBytes = randomBytes(32);
  const privateKey = privateKeyBytes.toString('hex');

  // Derive public key from private key
  const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
  const publicKey = Buffer.from(publicKeyBytes).toString('hex');

  return { privateKey, publicKey };
}

/**
 * Load or generate the client keypair
 */
export function loadOrCreateKeyPair(): KeyPair {
  ensurePonyDir();

  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    try {
      const privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf-8').trim();
      const publicKey = readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim();

      // Validate format (should be 64 hex chars each)
      if (privateKey.length === 64 && publicKey.length === 64) {
        return { privateKey, publicKey };
      }
      // Invalid format, regenerate
    } catch {
      // If reading fails, generate new keys
    }
  }

  // Generate new keypair
  const keyPair = generateKeyPair();

  // Save keys (hex format)
  writeFileSync(PRIVATE_KEY_PATH, keyPair.privateKey, { mode: 0o600 });
  writeFileSync(PUBLIC_KEY_PATH, keyPair.publicKey, { mode: 0o644 });

  return keyPair;
}

/**
 * Get the public key (load or create if needed)
 * Returns hex-encoded 32-byte public key
 */
export function getPublicKey(): string {
  const { publicKey } = loadOrCreateKeyPair();
  return publicKey;
}

/**
 * Sign a challenge with the private key
 *
 * @param challenge - The challenge string in hex format (from gateway)
 * @returns Signature in hex format (64 bytes = 128 hex chars)
 */
export function signChallenge(challenge: string): string {
  const { privateKey } = loadOrCreateKeyPair();

  // Challenge is hex-encoded, convert to bytes for signing
  const messageBytes = Buffer.from(challenge, 'hex');
  const privateKeyBytes = Buffer.from(privateKey, 'hex');

  // Sign the message
  const signatureBytes = ed.sign(messageBytes, privateKeyBytes);

  return Buffer.from(signatureBytes).toString('hex');
}

/**
 * Check if client has been paired (has a keypair)
 */
export function hasKeyPair(): boolean {
  return existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH);
}

/**
 * Delete the keypair (for re-pairing)
 */
export function deleteKeyPair(): void {
  try {
    if (existsSync(PRIVATE_KEY_PATH)) {
      unlinkSync(PRIVATE_KEY_PATH);
    }
    if (existsSync(PUBLIC_KEY_PATH)) {
      unlinkSync(PUBLIC_KEY_PATH);
    }
  } catch {
    // Ignore errors
  }
}
