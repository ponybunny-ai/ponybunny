export type AccountProvider = 'codex' | 'antigravity';

export interface BaseAccount {
  id: string;
  provider: AccountProvider;
  email?: string;
  userId?: string;
  addedAt: number;
  lastUsed: number;
  enabled: boolean;
  healthScore: number;
}

export interface CodexAccount extends BaseAccount {
  provider: 'codex';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AntigravityAccount extends BaseAccount {
  provider: 'antigravity';
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  rateLimitResetTimes?: {
    claude?: number;
    'gemini-antigravity'?: number;
    'gemini-cli'?: number;
  };
  fingerprint?: DeviceFingerprint;
}

export interface DeviceFingerprint {
  userAgent: string;
  platform: string;
  arch: string;
  nodeVersion: string;
}

export type Account = CodexAccount | AntigravityAccount;

export type LoadBalancingStrategy = 'stick' | 'round-robin' | 'hybrid';

export interface AccountsConfig {
  accounts: Account[];
  strategy: LoadBalancingStrategy;
  currentAccountId?: string;
  roundRobinIndex: number;
}

export interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

export interface HealthScoreState {
  score: number;
  consecutiveFailures: number;
  lastFailureTime?: number;
}

export type RateLimitReason = 
  | 'QUOTA_EXHAUSTED' 
  | 'RATE_LIMIT_EXCEEDED' 
  | 'MODEL_CAPACITY_EXHAUSTED'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN';

export interface RateLimitInfo {
  reason: RateLimitReason;
  resetTime?: number;
  retryAfter?: number;
  modelFamily?: string;
}
