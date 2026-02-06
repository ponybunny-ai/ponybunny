/**
 * Token Manager - Manages admin token for Gateway authentication.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';

interface TokenInfo {
  token: string;
  tokenId: string;
  expiresAt?: number;
}

interface DebugConfig {
  gateway?: {
    url?: string;
    token?: string;
    tokenId?: string;
    tokenExpiresAt?: number;
  };
  lastConnected?: number;
}

export class TokenManager {
  private configPath: string;
  private gatewayUrl: string;

  constructor(gatewayUrl: string, configPath?: string) {
    this.gatewayUrl = gatewayUrl;
    this.configPath = configPath ?? join(homedir(), '.ponybunny', 'debug-config.json');
  }

  /**
   * Get a valid admin token, refreshing if necessary.
   */
  async getToken(): Promise<TokenInfo> {
    const cached = await this.loadCachedToken();

    // Check if cached token is still valid (with 1 minute buffer)
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now() + 60000)) {
      return cached;
    }

    // Need to get a new token
    const newToken = await this.requestNewToken();
    await this.saveToken(newToken);
    return newToken;
  }

  /**
   * Set token directly (used when token is provided via CLI).
   */
  async setToken(token: string, tokenId: string, expiresAt?: number): Promise<void> {
    await this.saveToken({ token, tokenId, expiresAt });
  }

  /**
   * Load cached token from config file.
   */
  private async loadCachedToken(): Promise<TokenInfo | null> {
    try {
      const content = await readFile(this.configPath, 'utf-8');
      const config: DebugConfig = JSON.parse(content);

      if (config.gateway?.token && config.gateway?.tokenId) {
        return {
          token: config.gateway.token,
          tokenId: config.gateway.tokenId,
          expiresAt: config.gateway.tokenExpiresAt,
        };
      }
    } catch {
      // File doesn't exist or parse failed
    }
    return null;
  }

  /**
   * Request a new admin token from Gateway.
   */
  private async requestNewToken(): Promise<TokenInfo> {
    // Convert ws:// to http://
    const httpUrl = this.gatewayUrl.replace(/^ws/, 'http');

    const response = await fetch(`${httpUrl}/api/admin/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: 'debug-server' }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get admin token: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { token: string; id: string; expiresAt?: number };
    return {
      token: data.token,
      tokenId: data.id,
      expiresAt: data.expiresAt,
    };
  }

  /**
   * Save token to config file.
   */
  private async saveToken(tokenInfo: TokenInfo): Promise<void> {
    const dir = dirname(this.configPath);
    await mkdir(dir, { recursive: true });

    let config: DebugConfig = {};
    try {
      const content = await readFile(this.configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // Use empty config
    }

    config.gateway = {
      url: this.gatewayUrl,
      token: tokenInfo.token,
      tokenId: tokenInfo.tokenId,
      tokenExpiresAt: tokenInfo.expiresAt,
    };
    config.lastConnected = Date.now();

    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }
}
