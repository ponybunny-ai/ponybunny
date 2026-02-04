/**
 * Signature Verifier - Verifies Ed25519 signatures for authentication
 */

import * as ed from '@noble/ed25519';

export class SignatureVerifier {
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
        console.warn('[SignatureVerifier] Invalid signature length:', signatureBytes.length);
        return false;
      }
      if (publicKeyBytes.length !== 32) {
        console.warn('[SignatureVerifier] Invalid public key length:', publicKeyBytes.length);
        return false;
      }

      return await ed.verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
    } catch (error) {
      console.error('[SignatureVerifier] Verification error:', error);
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
