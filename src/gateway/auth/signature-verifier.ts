/**
 * Signature Verifier - Verifies Ed25519 signatures for authentication
 */

import * as ed from '@noble/ed25519';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

export class SignatureVerifier {
  private readonly logger: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger ?? new NoopLogger();
  }

  /**
   * Verify an Ed25519 signature
   * @param message - The original message (challenge) that was signed
   * @param signature - The signature in hex format
   * @param publicKey - The public key in hex format
   * @returns true if signature is valid
   */
  async verify(message: string, signature: string, publicKey: string): Promise<boolean> {
    try {
      const messageBytes = Buffer.from(message, 'hex');
      const signatureBytes = Buffer.from(signature, 'hex');
      const publicKeyBytes = Buffer.from(publicKey, 'hex');

      // Validate lengths
      if (signatureBytes.length !== 64) {
        this.logger.warn({ event: 'invalid_signature_length', length: signatureBytes.length }, `Invalid signature length: ${signatureBytes.length}`);
        return false;
      }
      if (publicKeyBytes.length !== 32) {
        this.logger.warn({ event: 'invalid_public_key_length', length: publicKeyBytes.length }, `Invalid public key length: ${publicKeyBytes.length}`);
        return false;
      }

      return await ed.verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
    } catch (error) {
      this.logger.error({ event: 'signature_verification_error' }, 'Verification error', error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Validate that a public key is well-formed
   * @param publicKey - The public key in hex format
   * @returns true if the public key is valid
   */
  isValidPublicKey(publicKey: string): boolean {
    try {
      const bytes = Buffer.from(publicKey, 'hex');
      return bytes.length === 32;
    } catch {
      return false;
    }
  }
}
