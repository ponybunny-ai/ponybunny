import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import type {
  Account,
  AccountProvider,
  AccountsConfig,
  AntigravityAccount,
  CodexAccount,
  LoadBalancingStrategy,
  OpenAICompatibleAccount,
  RateLimitReason,
} from './account-types.js';
import { HealthScoreTracker, TokenBucketTracker, calculateBackoffMs } from './account-trackers.js';
import { generateDeviceFingerprint } from './device-fingerprint.js';
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_DEFAULT_PROJECT_ID,
  ANTIGRAVITY_TOKEN_URL,
  type HeaderStyle,
} from './antigravity-constants.js';

type AccountsConfigV2 = AccountsConfig & {
  version?: number;
  currentAccountIdByProvider?: Partial<Record<AccountProvider, string>>;
  roundRobinIndexByProvider?: Partial<Record<AccountProvider, number>>;
};

const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type AntigravityAccessCache = {
  accessToken: string;
  expiresAt: number;
};

type AntigravitySession = {
  account: AntigravityAccount;
  accessToken: string;
  headerStyle: HeaderStyle;
  projectId: string;
  managedProjectId?: string;
};

function logDebug(message: string, extra?: Record<string, unknown>): void {
  if (process.env.PB_ANTIGRAVITY_DEBUG === '1' || process.env.PB_DEBUG === '1') {
    const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
    console.log(`[AuthManagerV2] ${message}${suffix}`);
  }
}

function logWarn(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.warn(`[AuthManagerV2] ${message}${suffix}`);
}

function nowMs(): number {
  return Date.now();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isLoadBalancingStrategy(value: unknown): value is LoadBalancingStrategy {
  return value === 'stick' || value === 'round-robin' || value === 'hybrid';
}

export class AccountManagerV2 {
  private configDir: string;
  private configPath: string;
  private config: AccountsConfigV2;
  private healthTracker = new HealthScoreTracker();
  private tokenBucket = new TokenBucketTracker();
  private refreshLocks = new Map<string, Promise<unknown>>();
  private antigravityAccessCache = new Map<string, AntigravityAccessCache>();
  private codexRateLimitResets = new Map<string, number>();

  constructor() {
    this.configDir = asString(process.env.PONYBUNNY_CONFIG_DIR) ?? join(homedir(), '.ponybunny');
    this.configPath = join(this.configDir, 'accounts.json');

    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    this.migrateOldConfig();
    this.config = this.loadConfig();
    this.initializeTrackers();
  }

  private migrateOldConfig(): void {
    const oldConfigPath = join(this.configDir, 'auth.json');
    if (!existsSync(oldConfigPath) || existsSync(this.configPath)) {
      return;
    }

    try {
      const oldData = JSON.parse(readFileSync(oldConfigPath, 'utf-8')) as {
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
        userId?: string;
        email?: string;
      };

      if (oldData.accessToken || oldData.refreshToken) {
        const account: CodexAccount = {
          id: this.generateAccountId(),
          provider: 'codex',
          email: oldData.email,
          userId: oldData.userId,
          accessToken: oldData.accessToken || '',
          refreshToken: oldData.refreshToken,
          expiresAt: oldData.expiresAt,
          addedAt: nowMs(),
          lastUsed: nowMs(),
          enabled: true,
          healthScore: 0,
        };

        const config: AccountsConfigV2 = {
          version: 2,
          accounts: [account],
          strategy: 'stick',
          currentAccountId: account.id,
          currentAccountIdByProvider: { codex: account.id },
          roundRobinIndex: 0,
          roundRobinIndexByProvider: { codex: 0 },
        };

        this.saveConfig(config);
        console.log('Migrated old auth config to multi-account format');
      }
    } catch (error) {
      logWarn('Failed to migrate legacy auth.json', { error: String(error) });
    }
  }

  private generateAccountId(): string {
    return `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private loadConfig(): AccountsConfigV2 {
    if (!existsSync(this.configPath)) {
      return {
        version: 2,
        accounts: [],
        strategy: 'stick',
        roundRobinIndex: 0,
        currentAccountIdByProvider: {},
        roundRobinIndexByProvider: {},
      };
    }

    try {
      const data = JSON.parse(readFileSync(this.configPath, 'utf-8')) as AccountsConfigV2;
      const normalized = this.normalizeConfig(data);
      if (normalized.changed) {
        this.saveConfig(normalized.config);
      }
      return normalized.config;
    } catch (error) {
      logWarn('Failed to parse accounts config, using defaults', { error: String(error) });
      return {
        version: 2,
        accounts: [],
        strategy: 'stick',
        roundRobinIndex: 0,
        currentAccountIdByProvider: {},
        roundRobinIndexByProvider: {},
      };
    }
  }

  private normalizeConfig(config: AccountsConfigV2): { config: AccountsConfigV2; changed: boolean } {
    let changed = false;
    const accounts = Array.isArray(config.accounts) ? config.accounts : [];
    const normalizedAccounts: Account[] = [];
    const now = nowMs();

    for (const account of accounts) {
      const normalized = this.normalizeAccount(account, now);
      if (normalized) {
        normalizedAccounts.push(normalized.account);
        changed = changed || normalized.changed;
      } else {
        changed = true;
      }
    }

    const strategy = isLoadBalancingStrategy(config.strategy) ? config.strategy : 'stick';
    if (strategy !== config.strategy) changed = true;

    const roundRobinIndex = asNumber(config.roundRobinIndex) ?? 0;
    if (roundRobinIndex !== config.roundRobinIndex) changed = true;

    const currentAccountIdByProvider = config.currentAccountIdByProvider ?? {};
    const roundRobinIndexByProvider = config.roundRobinIndexByProvider ?? {};

    return {
      changed,
      config: {
        version: 2,
        accounts: normalizedAccounts,
        strategy,
        currentAccountId: config.currentAccountId,
        currentAccountIdByProvider,
        roundRobinIndex,
        roundRobinIndexByProvider,
      },
    };
  }

  private normalizeAccount(account: Account, fallbackTime: number): { account: Account; changed: boolean } | null {
    if (!account || typeof account !== 'object') {
      return null;
    }

    const raw = account as Partial<Account> & {
      provider?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      projectId?: string;
      managedProjectId?: string;
      rateLimitResetTimes?: AntigravityAccount['rateLimitResetTimes'];
      fingerprint?: AntigravityAccount['fingerprint'];
      apiKey?: string;
      baseURL?: string;
    };

    let changed = false;
    let provider: AccountProvider;
    if (raw.provider === 'antigravity') {
      provider = 'antigravity';
    } else if (raw.provider === 'openai-compatible') {
      provider = 'openai-compatible';
    } else {
      provider = 'codex';
    }
    if (raw.provider !== provider) changed = true;

    const id = asString(raw.id) ?? this.generateAccountId();
    if (id !== raw.id) changed = true;

    const addedAt = asNumber(raw.addedAt) ?? fallbackTime;
    const lastUsed = asNumber(raw.lastUsed) ?? addedAt;
    const enabled = raw.enabled !== false;
    const healthScore = asNumber(raw.healthScore) ?? 0;

    if (provider === 'antigravity') {
      const refreshToken = asString(raw.refreshToken);
      if (!refreshToken) {
        return null;
      }

      const fingerprint = raw.fingerprint ?? generateDeviceFingerprint();
      if (!raw.fingerprint) changed = true;

      const rateLimitResetTimes = raw.rateLimitResetTimes ?? {};
      if (!raw.rateLimitResetTimes) changed = true;

      const normalized: AntigravityAccount = {
        id,
        provider,
        email: raw.email,
        userId: raw.userId,
        refreshToken,
        projectId: raw.projectId,
        managedProjectId: raw.managedProjectId,
        rateLimitResetTimes,
        fingerprint,
        addedAt,
        lastUsed,
        enabled,
        healthScore,
      };

      return { account: normalized, changed };
    }

    if (provider === 'openai-compatible') {
      const apiKey = asString(raw.apiKey);
      if (!apiKey) {
        return null;
      }

      const normalized: OpenAICompatibleAccount = {
        id,
        provider,
        email: raw.email,
        userId: raw.userId ?? raw.email,
        apiKey,
        baseURL: raw.baseURL,
        addedAt,
        lastUsed,
        enabled,
        healthScore,
      };

      return { account: normalized, changed };
    }

    const accessToken = raw.accessToken ?? '';
    const refreshToken = raw.refreshToken;
    if (!accessToken && !refreshToken) {
      return null;
    }

    const normalized: CodexAccount = {
      id,
      provider,
      email: raw.email,
      userId: raw.userId,
      accessToken,
      refreshToken,
      expiresAt: raw.expiresAt,
      addedAt,
      lastUsed,
      enabled,
      healthScore,
    };

    return { account: normalized, changed };
  }

  private saveConfig(config: AccountsConfigV2): void {
    this.config = config;
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private persist(): void {
    this.saveConfig(this.config);
  }

  private initializeTrackers(): void {
    for (const account of this.config.accounts) {
      this.healthTracker.initialize(account.id, account.healthScore);
      this.tokenBucket.initialize(account.id);
    }
  }

  getConfig(): AccountsConfigV2 {
    return this.config;
  }

  listAccounts(provider?: AccountProvider): Account[] {
    if (!provider) return [...this.config.accounts];
    return this.config.accounts.filter((account) => account.provider === provider);
  }

  getAccount(identifier: string, provider?: AccountProvider): Account | undefined {
    return this.config.accounts.find((account) => {
      if (provider && account.provider !== provider) return false;
      return account.id === identifier || account.email === identifier || account.userId === identifier;
    });
  }

  addCodexAccount(account: Omit<CodexAccount, 'id' | 'addedAt' | 'lastUsed' | 'provider' | 'enabled' | 'healthScore'>): CodexAccount {
    const existing = this.config.accounts.find(
      (acc) => acc.provider === 'codex' && (acc.email === account.email || acc.userId === account.userId),
    ) as CodexAccount | undefined;

    if (existing) {
      existing.accessToken = account.accessToken;
      existing.refreshToken = account.refreshToken;
      existing.expiresAt = account.expiresAt;
      existing.email = account.email;
      existing.userId = account.userId;
      existing.lastUsed = nowMs();
      this.persist();
      return existing;
    }

    const newAccount: CodexAccount = {
      id: this.generateAccountId(),
      provider: 'codex',
      email: account.email,
      userId: account.userId,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      expiresAt: account.expiresAt,
      addedAt: nowMs(),
      lastUsed: nowMs(),
      enabled: true,
      healthScore: 0,
    };

    this.config.accounts.push(newAccount);
    this.setCurrentAccount(newAccount.id);
    this.healthTracker.initialize(newAccount.id, newAccount.healthScore);
    this.tokenBucket.initialize(newAccount.id);
    this.persist();
    return newAccount;
  }

  addAntigravityAccount(account: Omit<AntigravityAccount, 'id' | 'addedAt' | 'lastUsed' | 'provider' | 'enabled' | 'healthScore'>): AntigravityAccount {
    const existing = this.config.accounts.find(
      (acc) => acc.provider === 'antigravity' && (acc.email === account.email || (acc as AntigravityAccount).refreshToken === account.refreshToken),
    ) as AntigravityAccount | undefined;

    if (existing) {
      existing.refreshToken = account.refreshToken;
      existing.projectId = account.projectId;
      existing.managedProjectId = account.managedProjectId;
      existing.rateLimitResetTimes = account.rateLimitResetTimes ?? existing.rateLimitResetTimes;
      existing.fingerprint = account.fingerprint ?? existing.fingerprint;
      existing.email = account.email;
      existing.userId = account.userId;
      existing.lastUsed = nowMs();
      this.persist();
      return existing;
    }

    const newAccount: AntigravityAccount = {
      id: this.generateAccountId(),
      provider: 'antigravity',
      email: account.email,
      userId: account.userId,
      refreshToken: account.refreshToken,
      projectId: account.projectId,
      managedProjectId: account.managedProjectId,
      rateLimitResetTimes: account.rateLimitResetTimes ?? {},
      fingerprint: account.fingerprint ?? generateDeviceFingerprint(),
      addedAt: nowMs(),
      lastUsed: nowMs(),
      enabled: true,
      healthScore: 0,
    };

    this.config.accounts.push(newAccount);
    this.setCurrentAccount(newAccount.id);
    this.healthTracker.initialize(newAccount.id, newAccount.healthScore);
    this.tokenBucket.initialize(newAccount.id);
    this.persist();
    return newAccount;
  }

  addOpenAICompatibleAccount(account: Omit<OpenAICompatibleAccount, 'id' | 'addedAt' | 'lastUsed' | 'provider' | 'enabled' | 'healthScore'>): OpenAICompatibleAccount {
    const existing = this.config.accounts.find(
      (acc) => acc.provider === 'openai-compatible' && acc.email === account.email,
    ) as OpenAICompatibleAccount | undefined;

    if (existing) {
      existing.apiKey = account.apiKey;
      existing.baseURL = account.baseURL;
      existing.email = account.email;
      existing.lastUsed = nowMs();
      this.persist();
      return existing;
    }

    const newAccount: OpenAICompatibleAccount = {
      id: this.generateAccountId(),
      provider: 'openai-compatible',
      email: account.email,
      userId: account.email,
      apiKey: account.apiKey,
      baseURL: account.baseURL,
      addedAt: nowMs(),
      lastUsed: nowMs(),
      enabled: true,
      healthScore: 0,
    };

    this.config.accounts.push(newAccount);
    this.setCurrentAccount(newAccount.id);
    this.healthTracker.initialize(newAccount.id, newAccount.healthScore);
    this.tokenBucket.initialize(newAccount.id);
    this.persist();
    return newAccount;
  }

  removeAccount(identifier: string): boolean {
    const index = this.config.accounts.findIndex(
      (account) => account.id === identifier || account.email === identifier || account.userId === identifier,
    );

    if (index === -1) return false;

    const removed = this.config.accounts[index]!;
    this.config.accounts.splice(index, 1);
    this.healthTracker.reset(removed.id);
    this.tokenBucket.reset(removed.id);
    this.antigravityAccessCache.delete(removed.id);
    this.codexRateLimitResets.delete(removed.id);

    if (this.config.currentAccountId === removed.id) {
      this.config.currentAccountId = this.config.accounts[0]?.id;
    }

    if (this.config.currentAccountIdByProvider?.[removed.provider] === removed.id) {
      this.config.currentAccountIdByProvider[removed.provider] =
        this.config.accounts.find((acc) => acc.provider === removed.provider)?.id;
    }

    this.persist();
    return true;
  }

  setCurrentAccount(identifier: string): boolean {
    const account = this.getAccount(identifier);
    if (!account) return false;

    this.config.currentAccountId = account.id;
    this.config.currentAccountIdByProvider = {
      ...(this.config.currentAccountIdByProvider ?? {}),
      [account.provider]: account.id,
    };
    this.config.strategy = 'stick';
    this.persist();
    return true;
  }

  setStrategy(strategy: LoadBalancingStrategy): void {
    this.config.strategy = strategy;
    if (strategy === 'round-robin') {
      this.config.roundRobinIndex = 0;
      this.config.roundRobinIndexByProvider = {};
    }
    this.persist();
  }

  getStrategy(): LoadBalancingStrategy {
    return this.config.strategy;
  }

  isAuthenticated(provider: AccountProvider = 'codex'): boolean {
    const account = this.getCurrentAccount(provider);
    if (!account) return false;

    if (provider === 'codex') {
      const codex = account as CodexAccount;
      if (codex.refreshToken) {
        return true;
      }

      if (!codex.accessToken) {
        return false;
      }

      if (!codex.expiresAt) {
        return true;
      }

      return codex.expiresAt >= nowMs();
    }

    if (provider === 'openai-compatible') {
      const compat = account as OpenAICompatibleAccount;
      return !!compat.apiKey;
    }

    const antigravity = account as AntigravityAccount;
    return !!antigravity.refreshToken;
  }

  async getAccessToken(provider: AccountProvider = 'codex'): Promise<string | undefined> {
    if (provider === 'antigravity') {
      const session = await this.getAntigravitySession({ modelFamily: 'claude' });
      return session?.accessToken;
    }

    const account = this.getCurrentAccount('codex');
    if (!account) return undefined;
    const codex = account as CodexAccount;

    if (this.shouldRefreshCodexToken(codex)) {
      const refreshed = await this.refreshCodexToken(codex);
      if (refreshed) {
        return refreshed.accessToken;
      }
    }

    return codex.accessToken;
  }

  getCurrentAccount(provider: AccountProvider = 'codex', options?: { modelFamily?: 'claude' | 'gemini' }): Account | undefined {
    const accounts = this.config.accounts.filter((account) => account.provider === provider && account.enabled !== false);
    if (accounts.length === 0) return undefined;

    const strategy = this.config.strategy;

    if (strategy === 'round-robin') {
      return this.selectRoundRobin(accounts, provider, options);
    }

    if (strategy === 'hybrid') {
      return this.selectHybrid(accounts, provider, options);
    }

    return this.selectSticky(accounts, provider, options);
  }

  private selectSticky(
    accounts: Account[],
    provider: AccountProvider,
    options?: { modelFamily?: 'claude' | 'gemini' },
  ): Account {
    const currentId = this.config.currentAccountIdByProvider?.[provider];
    const current = currentId ? accounts.find((account) => account.id === currentId) : undefined;
    if (current && !this.isRateLimited(current, options?.modelFamily)) {
      return current;
    }

    const available = accounts.find((account) => !this.isRateLimited(account, options?.modelFamily));
    return available ?? accounts[0]!;
  }

  private selectRoundRobin(
    accounts: Account[],
    provider: AccountProvider,
    options?: { modelFamily?: 'claude' | 'gemini' },
  ): Account {
    const available = accounts.filter((account) => !this.isRateLimited(account, options?.modelFamily));
    const list = available.length > 0 ? available : accounts;

    const indexByProvider = this.config.roundRobinIndexByProvider ?? {};
    const currentIndex = indexByProvider[provider] ?? 0;
    const account = list[currentIndex % list.length]!;
    indexByProvider[provider] = (currentIndex + 1) % list.length;
    this.config.roundRobinIndexByProvider = indexByProvider;
    this.config.currentAccountIdByProvider = {
      ...(this.config.currentAccountIdByProvider ?? {}),
      [provider]: account.id,
    };
    this.persist();
    return account;
  }

  private selectHybrid(
    accounts: Account[],
    provider: AccountProvider,
    options?: { modelFamily?: 'claude' | 'gemini' },
  ): Account {
    const candidates = accounts
      .filter((account) => !this.isRateLimited(account, options?.modelFamily))
      .map((account) => ({
        account,
        score: this.healthTracker.getScore(account.id),
        tokens: this.tokenBucket.getTokens(account.id),
        lastUsed: account.lastUsed,
      }))
      .sort((a, b) => {
        const hasTokensA = a.tokens > 0;
        const hasTokensB = b.tokens > 0;
        if (hasTokensA !== hasTokensB) {
          return hasTokensA ? -1 : 1;
        }
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.lastUsed - b.lastUsed;
      });

    const selected = candidates[0]?.account ?? accounts[0]!;
    this.tokenBucket.consumeTokens(selected.id);
    selected.lastUsed = nowMs();
    this.config.currentAccountIdByProvider = {
      ...(this.config.currentAccountIdByProvider ?? {}),
      [provider]: selected.id,
    };
    this.persist();
    return selected;
  }

  async getAntigravitySession(options?: { modelFamily?: 'claude' | 'gemini'; model?: string }): Promise<AntigravitySession | null> {
    const account = this.getCurrentAccount('antigravity', { modelFamily: options?.modelFamily });
    if (!account || account.provider !== 'antigravity') return null;

    const headerStyle = this.getAvailableHeaderStyle(account, options?.modelFamily ?? 'claude');
    if (!headerStyle) {
      return null;
    }

    const accessToken = await this.getAntigravityAccessToken(account);
    if (!accessToken) {
      return null;
    }

    const projectId = account.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID;

    return {
      account,
      accessToken,
      headerStyle,
      projectId,
      managedProjectId: account.managedProjectId,
    };
  }

  private getAvailableHeaderStyle(account: AntigravityAccount, family: 'claude' | 'gemini'): HeaderStyle | null {
    if (family === 'claude') {
      return this.isRateLimited(account, 'claude') ? null : 'antigravity';
    }

    if (!this.isRateLimited(account, 'gemini', 'antigravity')) {
      return 'antigravity';
    }
    if (!this.isRateLimited(account, 'gemini', 'gemini-cli')) {
      return 'gemini-cli';
    }
    return null;
  }

  markRequestSuccess(accountId: string): void {
    this.healthTracker.recordSuccess(accountId);
    const account = this.getAccount(accountId);
    if (account) {
      account.healthScore = this.healthTracker.getScore(accountId);
      account.lastUsed = nowMs();
      this.persist();
    }
  }

  markRequestFailure(accountId: string): void {
    this.healthTracker.recordFailure(accountId);
    const account = this.getAccount(accountId);
    if (account) {
      account.healthScore = this.healthTracker.getScore(accountId);
      this.persist();
    }
  }

  invalidateAntigravityAccess(accountId: string): void {
    this.antigravityAccessCache.delete(accountId);
  }

  markRateLimited(
    accountId: string,
    options: {
      modelFamily: 'claude' | 'gemini';
      reason: RateLimitReason;
      retryAfterMs?: number;
      headerStyle?: HeaderStyle;
    },
  ): number {
    const account = this.getAccount(accountId);
    this.healthTracker.recordRateLimit(accountId);
    const failures = Math.max(0, this.healthTracker.getConsecutiveFailures(accountId) - 1);
    const backoffMs = options.retryAfterMs && options.retryAfterMs > 0
      ? Math.max(options.retryAfterMs, 2000)
      : calculateBackoffMs(options.reason, failures);

    if (!account) {
      return backoffMs;
    }

    if (account.provider === 'antigravity') {
      const antigravity = account as AntigravityAccount;
      const key = this.getRateLimitKey(options.modelFamily, options.headerStyle);
      antigravity.rateLimitResetTimes = antigravity.rateLimitResetTimes ?? {};
      antigravity.rateLimitResetTimes[key] = nowMs() + backoffMs;
      antigravity.healthScore = this.healthTracker.getScore(accountId);
      this.persist();
      return backoffMs;
    }

    this.codexRateLimitResets.set(accountId, nowMs() + backoffMs);
    account.healthScore = this.healthTracker.getScore(accountId);
    this.persist();
    return backoffMs;
  }

  private getRateLimitKey(family: 'claude' | 'gemini', headerStyle?: HeaderStyle): keyof NonNullable<AntigravityAccount['rateLimitResetTimes']> {
    if (family === 'claude') {
      return 'claude';
    }
    return headerStyle === 'gemini-cli' ? 'gemini-cli' : 'gemini-antigravity';
  }

  private isRateLimited(account: Account, family?: 'claude' | 'gemini', headerStyle?: HeaderStyle): boolean {
    if (account.provider === 'antigravity') {
      return this.isAntigravityRateLimited(account as AntigravityAccount, family, headerStyle);
    }
    const resetTime = this.codexRateLimitResets.get(account.id);
    if (!resetTime) return false;
    if (nowMs() >= resetTime) {
      this.codexRateLimitResets.delete(account.id);
      return false;
    }
    return true;
  }

  private isAntigravityRateLimited(
    account: AntigravityAccount,
    family?: 'claude' | 'gemini',
    headerStyle?: HeaderStyle,
  ): boolean {
    const resetTimes = account.rateLimitResetTimes ?? {};
    this.clearExpiredRateLimits(resetTimes);

    if (!family || family === 'claude') {
      const claudeReset = resetTimes.claude;
      return typeof claudeReset === 'number' && nowMs() < claudeReset;
    }

    if (headerStyle) {
      const key = headerStyle === 'gemini-cli' ? 'gemini-cli' : 'gemini-antigravity';
      const reset = resetTimes[key];
      return typeof reset === 'number' && nowMs() < reset;
    }

    const antigravityReset = resetTimes['gemini-antigravity'];
    const cliReset = resetTimes['gemini-cli'];
    const antigravityLimited = typeof antigravityReset === 'number' && nowMs() < antigravityReset;
    const cliLimited = typeof cliReset === 'number' && nowMs() < cliReset;
    return antigravityLimited && cliLimited;
  }

  private clearExpiredRateLimits(resetTimes: NonNullable<AntigravityAccount['rateLimitResetTimes']>): void {
    const now = nowMs();
    for (const key of Object.keys(resetTimes) as Array<keyof typeof resetTimes>) {
      const resetTime = resetTimes[key];
      if (resetTime !== undefined && now >= resetTime) {
        delete resetTimes[key];
      }
    }
  }

  private shouldRefreshCodexToken(account: CodexAccount): boolean {
    if (!account.refreshToken || !account.expiresAt) {
      return false;
    }
    return account.expiresAt - TOKEN_REFRESH_BUFFER_MS < nowMs();
  }

  private async refreshCodexToken(account: CodexAccount): Promise<CodexAccount | null> {
    if (!account.refreshToken) return null;
    return this.withRefreshLock(account.id, async () => {
      logDebug('Refreshing Codex token', { account: account.email || account.userId });
      try {
        const response = await fetch(CODEX_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken!,
            client_id: CODEX_CLIENT_ID,
          }).toString(),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          logWarn('Codex token refresh failed', { status: response.status, error: errorText });
          return null;
        }

        const tokens = await response.json() as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        };

        const updated: CodexAccount = {
          ...account,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || account.refreshToken,
          expiresAt: tokens.expires_in ? nowMs() + tokens.expires_in * 1000 : account.expiresAt,
        };

        const index = this.config.accounts.findIndex((acc) => acc.id === account.id);
        if (index !== -1) {
          this.config.accounts[index] = updated;
          this.persist();
        }

        return updated;
      } catch (error) {
        logWarn('Codex token refresh error', { error: String(error) });
        return null;
      }
    });
  }

  private async getAntigravityAccessToken(account: AntigravityAccount): Promise<string | undefined> {
    const cached = this.antigravityAccessCache.get(account.id);
    if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > nowMs()) {
      return cached.accessToken;
    }

    const refreshed = await this.refreshAntigravityToken(account);
    return refreshed?.accessToken;
  }

  private async refreshAntigravityToken(account: AntigravityAccount): Promise<AntigravityAccessCache | null> {
    return this.withRefreshLock(`antigravity:${account.id}`, async () => {
      logDebug('Refreshing Antigravity token', { account: account.email });
      try {
        const response = await fetch(ANTIGRAVITY_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken,
            client_id: ANTIGRAVITY_CLIENT_ID,
            client_secret: ANTIGRAVITY_CLIENT_SECRET,
          }).toString(),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          logWarn('Antigravity token refresh failed', { status: response.status, error: errorText });
          return null;
        }

        const payload = await response.json() as {
          access_token: string;
          expires_in?: number;
          refresh_token?: string;
        };

        if (!payload.access_token) {
          return null;
        }

        if (payload.refresh_token && payload.refresh_token !== account.refreshToken) {
          account.refreshToken = payload.refresh_token;
          this.persist();
        }

        const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
        const cache: AntigravityAccessCache = {
          accessToken: payload.access_token,
          expiresAt: nowMs() + expiresIn * 1000,
        };

        this.antigravityAccessCache.set(account.id, cache);
        return cache;
      } catch (error) {
        logWarn('Antigravity token refresh error', { error: String(error) });
        return null;
      }
    });
  }

  private async withRefreshLock<T>(key: string, refresh: () => Promise<T>): Promise<T> {
    const existing = this.refreshLocks.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = refresh().finally(() => {
      this.refreshLocks.delete(key);
    });
    this.refreshLocks.set(key, promise as Promise<unknown>);
    return promise as Promise<T>;
  }

  clearAllAccounts(): void {
    this.config.accounts = [];
    this.config.strategy = 'stick';
    this.config.currentAccountId = undefined;
    this.config.currentAccountIdByProvider = {};
    this.config.roundRobinIndex = 0;
    this.config.roundRobinIndexByProvider = {};
    this.persist();
  }
}

export const accountManagerV2 = new AccountManagerV2();

export const authManagerV2 = {
  getAccessToken: () => accountManagerV2.getAccessToken('codex'),
  isAuthenticated: () => accountManagerV2.isAuthenticated('codex'),
  getConfig: () => {
    const account = accountManagerV2.getCurrentAccount('codex') as CodexAccount | undefined;
    return account
      ? {
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          expiresAt: account.expiresAt,
          userId: account.userId,
          email: account.email,
        }
      : {};
  },
  saveConfig: (config: Partial<CodexAccount>) => {
    if (!config.accessToken) {
      return;
    }
    accountManagerV2.addCodexAccount({
      email: config.email,
      userId: config.userId,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
      expiresAt: config.expiresAt,
    });
  },
  clearConfig: () => accountManagerV2.clearAllAccounts(),
};
