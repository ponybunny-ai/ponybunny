/**
 * Challenge Generator - Creates Ed25519 authentication challenges
 */

import { randomBytes } from 'crypto';

export interface Challenge {
  challenge: string;
  expiresAt: number;
}

export interface ChallengeGeneratorConfig {
  challengeBytes: number;
  challengeTtlMs: number;
}

const DEFAULT_CONFIG: ChallengeGeneratorConfig = {
  challengeBytes: 32,
  challengeTtlMs: 60000, // 1 minute
};

export class ChallengeGenerator {
  private pendingChallenges = new Map<string, Challenge>();
  private config: ChallengeGeneratorConfig;

  constructor(config: Partial<ChallengeGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  generate(connectionId: string): Challenge {
    // Clean up expired challenges periodically
    this.cleanupExpired();

    const challengeBytes = randomBytes(this.config.challengeBytes);
    const challenge: Challenge = {
      challenge: challengeBytes.toString('hex'),
      expiresAt: Date.now() + this.config.challengeTtlMs,
    };

    this.pendingChallenges.set(connectionId, challenge);
    return challenge;
  }

  getChallenge(connectionId: string): Challenge | undefined {
    const challenge = this.pendingChallenges.get(connectionId);
    if (!challenge) return undefined;

    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(connectionId);
      return undefined;
    }

    return challenge;
  }

  consumeChallenge(connectionId: string): Challenge | undefined {
    const challenge = this.getChallenge(connectionId);
    if (challenge) {
      this.pendingChallenges.delete(connectionId);
    }
    return challenge;
  }

  removeChallenge(connectionId: string): void {
    this.pendingChallenges.delete(connectionId);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, challenge] of this.pendingChallenges) {
      if (now > challenge.expiresAt) {
        this.pendingChallenges.delete(id);
      }
    }
  }

  getPendingCount(): number {
    return this.pendingChallenges.size;
  }
}
