import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export interface AuthConfig {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  email?: string;
  gatewayUrl?: string;
}

export class AuthManager {
  private configDir: string;
  private configPath: string;

  constructor() {
    this.configDir = join(homedir(), '.ponybunny');
    this.configPath = join(this.configDir, 'auth.json');
    
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  getConfig(): AuthConfig {
    if (!existsSync(this.configPath)) {
      return {};
    }
    
    try {
      const data = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  saveConfig(config: AuthConfig): void {
    const existing = this.getConfig();
    const merged = { ...existing, ...config };
    writeFileSync(this.configPath, JSON.stringify(merged, null, 2), 'utf-8');
  }

  clearConfig(): void {
    if (existsSync(this.configPath)) {
      writeFileSync(this.configPath, '{}', 'utf-8');
    }
  }

  isAuthenticated(): boolean {
    const config = this.getConfig();
    
    if (!config.accessToken) {
      return false;
    }
    
    if (config.expiresAt && config.expiresAt < Date.now()) {
      return false;
    }
    
    return true;
  }

  getAccessToken(): string | undefined {
    const config = this.getConfig();
    return config.accessToken;
  }

  getGatewayUrl(): string {
    const config = this.getConfig();
    return config.gatewayUrl || 'https://api.ponybunny.ai';
  }
}

export const authManager = new AuthManager();
