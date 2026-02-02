import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export interface Account {
  id: string;
  email?: string;
  userId?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  addedAt: number;
}

export type LoadBalancingStrategy = 'stick' | 'round-robin';

export interface AccountsConfig {
  accounts: Account[];
  strategy: LoadBalancingStrategy;
  currentAccountId?: string;
  roundRobinIndex: number;
}

export class AccountManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    this.configDir = join(homedir(), '.ponybunny');
    this.configPath = join(this.configDir, 'accounts.json');
    
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    this.migrateOldConfig();
  }

  private migrateOldConfig(): void {
    const oldConfigPath = join(this.configDir, 'auth.json');
    if (existsSync(oldConfigPath) && !existsSync(this.configPath)) {
      try {
        const oldData = JSON.parse(readFileSync(oldConfigPath, 'utf-8'));
        if (oldData.accessToken) {
          const account: Account = {
            id: this.generateAccountId(),
            email: oldData.email,
            userId: oldData.userId,
            accessToken: oldData.accessToken,
            refreshToken: oldData.refreshToken,
            expiresAt: oldData.expiresAt,
            addedAt: Date.now(),
          };
          
          const config: AccountsConfig = {
            accounts: [account],
            strategy: 'stick',
            currentAccountId: account.id,
            roundRobinIndex: 0,
          };
          
          this.saveConfig(config);
          console.log('Migrated old auth config to multi-account format');
        }
      } catch (e) {
      }
    }
  }

  private generateAccountId(): string {
    return `acc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getConfig(): AccountsConfig {
    if (!existsSync(this.configPath)) {
      return {
        accounts: [],
        strategy: 'stick',
        roundRobinIndex: 0,
      };
    }
    
    try {
      const data = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {
        accounts: [],
        strategy: 'stick',
        roundRobinIndex: 0,
      };
    }
  }

  saveConfig(config: AccountsConfig): void {
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  addAccount(account: Omit<Account, 'id' | 'addedAt'>): Account {
    const config = this.getConfig();
    
    const existingIndex = config.accounts.findIndex(
      a => a.email === account.email || a.userId === account.userId
    );
    
    if (existingIndex !== -1) {
      config.accounts[existingIndex] = {
        ...config.accounts[existingIndex],
        ...account,
        addedAt: config.accounts[existingIndex].addedAt,
      };
      
      this.saveConfig(config);
      return config.accounts[existingIndex];
    }
    
    const newAccount: Account = {
      id: this.generateAccountId(),
      ...account,
      addedAt: Date.now(),
    };
    
    config.accounts.push(newAccount);
    
    if (config.accounts.length === 1) {
      config.currentAccountId = newAccount.id;
    }
    
    this.saveConfig(config);
    return newAccount;
  }

  removeAccount(identifier: string): boolean {
    const config = this.getConfig();
    const index = config.accounts.findIndex(
      a => a.id === identifier || a.email === identifier || a.userId === identifier
    );
    
    if (index === -1) return false;
    
    const removedAccount = config.accounts[index];
    config.accounts.splice(index, 1);
    
    if (config.currentAccountId === removedAccount.id) {
      config.currentAccountId = config.accounts[0]?.id;
    }
    
    this.saveConfig(config);
    return true;
  }

  listAccounts(): Account[] {
    return this.getConfig().accounts;
  }

  getAccount(identifier: string): Account | undefined {
    const config = this.getConfig();
    return config.accounts.find(
      a => a.id === identifier || a.email === identifier || a.userId === identifier
    );
  }

  getCurrentAccount(): Account | undefined {
    const config = this.getConfig();
    
    if (config.strategy === 'stick') {
      if (config.currentAccountId) {
        return config.accounts.find(a => a.id === config.currentAccountId);
      }
      return config.accounts[0];
    }
    
    if (config.strategy === 'round-robin') {
      if (config.accounts.length === 0) return undefined;
      
      const account = config.accounts[config.roundRobinIndex % config.accounts.length];
      
      config.roundRobinIndex = (config.roundRobinIndex + 1) % config.accounts.length;
      this.saveConfig(config);
      
      return account;
    }
    
    return config.accounts[0];
  }

  setCurrentAccount(identifier: string): boolean {
    const config = this.getConfig();
    const account = config.accounts.find(
      a => a.id === identifier || a.email === identifier || a.userId === identifier
    );
    
    if (!account) return false;
    
    config.currentAccountId = account.id;
    config.strategy = 'stick';
    this.saveConfig(config);
    return true;
  }

  setStrategy(strategy: LoadBalancingStrategy): void {
    const config = this.getConfig();
    config.strategy = strategy;
    
    if (strategy === 'round-robin') {
      config.roundRobinIndex = 0;
    }
    
    this.saveConfig(config);
  }

  getStrategy(): LoadBalancingStrategy {
    return this.getConfig().strategy;
  }

  isAuthenticated(): boolean {
    const account = this.getCurrentAccount();
    if (!account) return false;
    
    if (account.expiresAt && account.expiresAt < Date.now()) {
      return false;
    }
    
    return true;
  }

  async getAccessToken(): Promise<string | undefined> {
    const account = this.getCurrentAccount();
    if (!account) return undefined;
    
    if (this.shouldRefreshToken(account)) {
      const refreshed = await this.refreshAccessToken(account);
      if (refreshed) {
        return refreshed.accessToken;
      }
    }
    
    return account.accessToken;
  }

  private shouldRefreshToken(account: Account): boolean {
    if (!account.expiresAt || !account.refreshToken) {
      return false;
    }
    
    const bufferTime = 5 * 60 * 1000;
    return account.expiresAt - bufferTime < Date.now();
  }

  private async refreshAccessToken(account: Account): Promise<Account | null> {
    if (!account.refreshToken) return null;
    
    console.log(`[Token Manager] Refreshing token for ${account.email || account.userId}...`);
    
    try {
      const response = await fetch('https://auth.openai.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: account.refreshToken,
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        }).toString(),
      });

      if (!response.ok) {
        console.error(`[Token Manager] Failed to refresh token: ${response.statusText}`);
        return null;
      }

      const tokens = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const updatedAccount: Account = {
        ...account,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || account.refreshToken,
        expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : account.expiresAt,
      };

      const config = this.getConfig();
      const index = config.accounts.findIndex(a => a.id === account.id);
      if (index !== -1) {
        config.accounts[index] = updatedAccount;
        this.saveConfig(config);
      }

      const expiresIn = tokens.expires_in ? Math.floor(tokens.expires_in / 60) : 'unknown';
      console.log(`[Token Manager] Token refreshed successfully (expires in ~${expiresIn} minutes)`);

      return updatedAccount;
    } catch (error) {
      console.error('[Token Manager] Error refreshing token:', error);
      return null;
    }
  }

  clearAllAccounts(): void {
    const config: AccountsConfig = {
      accounts: [],
      strategy: 'stick',
      roundRobinIndex: 0,
    };
    this.saveConfig(config);
  }
}

export const accountManager = new AccountManager();

export const authManager = {
  getAccessToken: () => accountManager.getAccessToken(),
  isAuthenticated: () => accountManager.isAuthenticated(),
  getConfig: () => {
    const account = accountManager.getCurrentAccount();
    return account ? {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      expiresAt: account.expiresAt,
      userId: account.userId,
      email: account.email,
    } : {};
  },
  saveConfig: (config: Partial<Account>) => {
    accountManager.addAccount({
      email: config.email,
      userId: config.userId,
      accessToken: config.accessToken!,
      refreshToken: config.refreshToken,
      expiresAt: config.expiresAt,
    });
  },
  clearConfig: () => accountManager.clearAllAccounts(),
};
