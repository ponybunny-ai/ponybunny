import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import inquirer from 'inquirer';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { accountManagerV2 } from '../lib/auth-manager-v2.js';
import type { Account, AccountProvider, AntigravityAccount, CodexAccount, OpenAICompatibleAccount } from '../lib/account-types.js';
import { getAllEndpointConfigs } from '../../infra/llm/endpoints/index.js';
import {
  clearCredentialsCache,
  getCachedCredentials,
  loadCredentialsFile,
  saveCredentialsFile,
  type EndpointCredential,
} from '../../infra/config/credentials-loader.js';

// OpenAI Codex CLI OAuth configuration
// Using the official Codex CLI Client ID to ensure compatibility
const OAUTH_CONFIG = {
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access',
};

interface PKCEPair {
  verifier: string;
  challenge: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

// Generate PKCE (Proof Key for Code Exchange) for secure OAuth
function generatePKCE(): PKCEPair {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url');
  
  return { verifier, challenge };
}

function createState(): string {
  return randomBytes(16).toString('hex');
}

async function loginWithOAuth(): Promise<void> {
  const spinner = ora('Initializing OpenAI Codex OAuth login...').start();
  
  // Generate PKCE and state
  const pkce = generatePKCE();
  const state = createState();
  
  // Construct OAuth URL with Codex-specific parameters
  const url = new URL(OAUTH_CONFIG.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', OAUTH_CONFIG.clientId);
  url.searchParams.set('redirect_uri', OAUTH_CONFIG.redirectUri);
  url.searchParams.set('scope', OAUTH_CONFIG.scope);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  
  // Critical parameters for Codex flow
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'codex_cli_rs');
  
  const authUrl = url.toString();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const clearAuthTimeout = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearAuthTimeout();
      resolve();
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAuthTimeout();
      reject(error);
    };

    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/auth/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const callbackUrl = new URL(req.url, OAUTH_CONFIG.redirectUri);
      const code = callbackUrl.searchParams.get('code');
      const returnedState = callbackUrl.searchParams.get('state');
      const error = callbackUrl.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Failed - PonyBunny</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #ff6b6b; }
    p { color: #a0a0a0; margin-bottom: 0.5rem; }
    .error-code {
      background: rgba(255, 107, 107, 0.1);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-family: monospace;
      color: #ff6b6b;
      margin: 1rem 0;
    }
    .hint { font-size: 0.875rem; color: #666; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">❌</div>
    <h1>Authentication Failed</h1>
    <div class="error-code">${error}</div>
    <p class="hint">You can close this window and try again.</p>
  </div>
</body>
</html>`);
        server.close();
        spinner.fail('Authentication failed');
        rejectOnce(new Error(error));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Error - PonyBunny</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #f59e0b; }
    p { color: #a0a0a0; line-height: 1.6; }
    .hint { font-size: 0.875rem; color: #666; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⚠️</div>
    <h1>Security Validation Failed</h1>
    <p>State mismatch detected. This could indicate a CSRF attack or an expired authentication session.</p>
    <p class="hint">Please close this window and try again.</p>
  </div>
</body>
</html>`);
        server.close();
        spinner.fail('State validation failed');
        rejectOnce(new Error('State mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Missing Code - PonyBunny</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #ff6b6b; }
    p { color: #a0a0a0; line-height: 1.6; }
    .hint { font-size: 0.875rem; color: #666; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">❌</div>
    <h1>Missing Authorization Code</h1>
    <p>The authorization code was not received from the authentication server.</p>
    <p class="hint">Please close this window and try again.</p>
  </div>
</body>
</html>`);
        server.close();
        spinner.fail('Missing authorization code');
        rejectOnce(new Error('Missing code'));
        return;
      }

      spinner.text = 'Exchanging authorization code for tokens...';

      try {
        const tokenResponse = await fetch(OAUTH_CONFIG.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: OAUTH_CONFIG.redirectUri,
            client_id: OAUTH_CONFIG.clientId,
            code_verifier: pkce.verifier,
          }).toString(),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Token exchange failed: ${tokenResponse.statusText} - ${errorText}`);
        }

        const tokens: OAuthTokenResponse = await tokenResponse.json() as OAuthTokenResponse;

        // Parse ID token to get user info
        let email: string | undefined;
        let userId: string | undefined;
        
        if (tokens.id_token) {
          try {
            // Decode JWT payload (not validating signature since we trust the source)
            const payload = JSON.parse(
              Buffer.from(tokens.id_token.split('.')[1], 'base64').toString()
            );
        email = payload.email;
        userId = payload.sub;
      } catch {
        console.log(chalk.yellow('Warning: Could not parse user info from token'));
      }
    }

    accountManagerV2.addCodexAccount({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
      userId,
      email,
    });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful - PonyBunny</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #4ade80; }
    p { color: #a0a0a0; line-height: 1.6; }
    .countdown {
      margin-top: 1.5rem;
      font-size: 0.875rem;
      color: #666;
    }
    .progress-bar {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      margin-top: 1rem;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4ade80, #22c55e);
      animation: shrink 3s linear forwards;
    }
    @keyframes shrink {
      from { width: 100%; }
      to { width: 0%; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✓</div>
    <h1>Authentication Successful</h1>
    <p>You have been logged in successfully.<br>You can now close this window and return to the terminal.</p>
    <div class="progress-bar"><div class="progress-fill"></div></div>
    <p class="countdown">This window will close automatically...</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`);

        server.close();
        spinner.succeed('Successfully authenticated!');
        
        const accounts = accountManagerV2.listAccounts('codex');
        console.log(chalk.green(`\n✓ Logged in as: ${email || userId || 'User'}`));
        console.log(chalk.cyan(`✓ Account added (${accounts.length} total account${accounts.length > 1 ? 's' : ''})\n`));
        
        if (accounts.length === 1) {
          console.log(chalk.gray('  This is your first account and will be used by default\n'));
        } else {
          console.log(chalk.gray("  Use 'pb auth switch' to choose the active account"));
          console.log(chalk.gray(`  Use 'pb auth list' to see all accounts`));
        }
        
        resolveOnce();
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Server Error - PonyBunny</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 3rem;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 400px;
    }
    .icon { font-size: 4rem; margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #ff6b6b; }
    p { color: #a0a0a0; line-height: 1.6; }
    .hint { font-size: 0.875rem; color: #666; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">⚙️</div>
    <h1>Internal Server Error</h1>
    <p>An error occurred while exchanging the authorization code for tokens.</p>
    <p class="hint">Please close this window and try again.</p>
  </div>
</body>
</html>`);
        server.close();
        spinner.fail('Token exchange failed');
        rejectOnce(error as Error);
      }
    });

    const port = 1455; // Must use port 1455 for Codex CLI client
    server.listen(port, () => {
      spinner.succeed('OAuth server started on port 1455');
      console.log(chalk.cyan(`\nOpening browser for authentication...`));
      console.log(chalk.gray(`If browser doesn't open, visit: ${authUrl}\n`));
      
      open(authUrl).catch(() => {
        console.log(chalk.yellow(`Please manually open: ${authUrl}`));
      });
    });

    // 2 minute timeout
    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      server.close();
      spinner.fail('Authentication timeout (2 minutes)');
      rejectOnce(new Error('Timeout'));
    }, 120000);
  });
}

async function loginWithAPIKey(): Promise<void> {
  const spinner = ora('Setting up API key authentication...').start();
  spinner.stop();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiKey',
      message: 'Enter your API key:',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'API key cannot be empty';
        }
        if (input.trim().length < 20) {
          return 'API key seems too short. Please check and try again.';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'baseURL',
      message: 'Enter base URL (optional, press Enter to skip):',
      default: '',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return true;
        }
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL (e.g., https://api.openai.com/v1)';
        }
      },
    },
    {
      type: 'input',
      name: 'email',
      message: 'Enter email or identifier (optional):',
      default: '',
    },
  ]);

  accountManagerV2.addOpenAICompatibleAccount({
    apiKey: answers.apiKey.trim(),
    baseURL: answers.baseURL.trim() || undefined,
    email: answers.email.trim() || undefined,
  });

  const accounts = accountManagerV2.listAccounts('openai-compatible');
  console.log(chalk.green(`\n✓ API key account added successfully!`));
  console.log(chalk.cyan(`✓ Total API key accounts: ${accounts.length}\n`));
  
  if (answers.baseURL) {
    console.log(chalk.gray(`  Base URL: ${answers.baseURL}`));
  } else {
    console.log(chalk.gray(`  Using default OpenAI base URL`));
  }
  console.log();
}

async function logout(): Promise<void> {
  accountManagerV2.clearAllAccounts();
  console.log(chalk.green('✓ Successfully logged out all accounts'));
}

async function whoami(): Promise<void> {
  if (!accountManagerV2.isAuthenticated('codex')) {
    console.log(chalk.red('Not authenticated. Run `pb auth login` first.'));
    process.exit(1);
  }

  const account = accountManagerV2.getCurrentAccount('codex') as CodexAccount | undefined;
  const strategy = accountManagerV2.getStrategy();
  
  console.log(chalk.cyan('\nCurrent Account:'));
  console.log(chalk.white(`  User: ${account?.email || account?.userId || 'Unknown'}`));
  console.log(chalk.white(`  Token expires: ${account?.expiresAt ? new Date(account.expiresAt).toLocaleString() : 'Never'}`));
  console.log(chalk.white(`  Strategy: ${strategy}`));
  console.log();
}

interface EnabledCredentialProvider {
  id: string;
  name: string;
  maskedApiKey?: string;
}

interface ProviderFieldDefinition {
  key: keyof EndpointCredential;
  label: string;
  kind: 'boolean' | 'text' | 'secret' | 'url';
  optional?: boolean;
}

interface ProviderConfigDefinition {
  endpointId: string;
  displayName: string;
  fields: ProviderFieldDefinition[];
}

const PROVIDER_FIELD_DEFINITIONS: Record<string, ProviderFieldDefinition[]> = {
  'anthropic-direct': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'apiKey', label: 'API Key', kind: 'secret' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
  'aws-bedrock': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'accessKeyId', label: 'Access Key ID', kind: 'secret' },
    { key: 'secretAccessKey', label: 'Secret Access Key', kind: 'secret' },
    { key: 'region', label: 'Region', kind: 'text' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
  'openai-direct': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'apiKey', label: 'API Key', kind: 'secret' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
  'azure-openai': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'apiKey', label: 'API Key', kind: 'secret' },
    { key: 'endpoint', label: 'Endpoint URL', kind: 'url' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
  'openai-compatible': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'apiKey', label: 'API Key', kind: 'secret' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
  'google-ai-studio': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'apiKey', label: 'API Key', kind: 'secret' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
  'google-vertex-ai': [
    { key: 'enabled', label: 'Enabled', kind: 'boolean' },
    { key: 'projectId', label: 'Project ID', kind: 'text' },
    { key: 'region', label: 'Region', kind: 'text' },
    { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
  ],
};

function maskApiKey(apiKey: string): string {
  const visiblePart = apiKey.slice(0, 15);
  return `${visiblePart}***`;
}

function listEnabledCredentialProviders(): EnabledCredentialProvider[] {
  const credentials = getCachedCredentials();
  const endpointMap = new Map<string, string>(
    getAllEndpointConfigs().map((endpoint) => [endpoint.id, endpoint.displayName])
  );
  const providers: EnabledCredentialProvider[] = [];

  for (const [endpointId, credential] of Object.entries(credentials?.endpoints ?? {})) {
    if (credential?.enabled !== true) {
      continue;
    }

    const displayName = endpointId === 'openai-compatible'
      ? 'OpenAI-Compatible'
      : endpointMap.get(endpointId) ?? endpointId;

    providers.push({
      id: endpointId,
      name: displayName,
      maskedApiKey: credential.apiKey ? maskApiKey(credential.apiKey) : undefined,
    });
  }

  return providers;
}

function getAccountProviderLabel(provider: AccountProvider): string {
  switch (provider) {
    case 'codex':
      return 'OpenAI Codex';
    case 'antigravity':
      return 'Google Antigravity';
    case 'openai-compatible':
      return 'OpenAI-Compatible';
    default:
      return provider;
  }
}

function maskSensitiveValue(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getProviderConfigDefinitions(): ProviderConfigDefinition[] {
  return getAllEndpointConfigs()
    .filter((endpoint) => endpoint.id !== 'codex')
    .map((endpoint) => ({
      endpointId: endpoint.id,
      displayName: endpoint.displayName,
      fields: PROVIDER_FIELD_DEFINITIONS[endpoint.id] ?? [
        { key: 'enabled', label: 'Enabled', kind: 'boolean' },
        { key: 'apiKey', label: 'API Key', kind: 'secret' },
        { key: 'baseUrl', label: 'Base URL', kind: 'url', optional: true },
      ],
    }));
}

function getCredentialForEndpoint(endpointId: string): EndpointCredential {
  const credentials = loadCredentialsFile();
  return credentials?.endpoints?.[endpointId] ?? {};
}

function upsertCredentialForEndpoint(endpointId: string, updates: Partial<EndpointCredential>): void {
  const credentials = loadCredentialsFile() ?? { endpoints: {} };

  if (!credentials.endpoints) {
    credentials.endpoints = {};
  }

  const existing = credentials.endpoints[endpointId] ?? {};
  credentials.endpoints[endpointId] = {
    ...existing,
    ...updates,
  };

  saveCredentialsFile(credentials);
  clearCredentialsCache();
}

function formatProviderFieldValue(field: ProviderFieldDefinition, credential: EndpointCredential): string {
  const value = credential[field.key];

  if (field.kind === 'boolean') {
    return value === true ? 'enabled' : 'disabled';
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return field.optional ? '(empty)' : '(not set)';
  }

  if (field.kind === 'secret') {
    return maskSensitiveValue(value);
  }

  return value;
}

function validateProviderInput(field: ProviderFieldDefinition, input: string): true | string {
  const trimmed = input.trim();

  if (!field.optional && trimmed.length === 0) {
    return `${field.label} cannot be empty`;
  }

  if (field.kind === 'url' && trimmed.length > 0) {
    try {
      new URL(trimmed);
    } catch {
      return `Please enter a valid URL for ${field.label}`;
    }
  }

  return true;
}

async function promptAndUpdateProviderField(
  provider: ProviderConfigDefinition,
  field: ProviderFieldDefinition,
  credential: EndpointCredential,
): Promise<void> {
  if (field.kind === 'boolean') {
    const { value } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'value',
        message: `Set ${provider.displayName} ${field.label.toLowerCase()}?`,
        default: credential.enabled === true,
      },
    ]);

    upsertCredentialForEndpoint(provider.endpointId, { [field.key]: value });
    return;
  }

  const currentValue = typeof credential[field.key] === 'string'
    ? String(credential[field.key])
    : '';

  const { value } = await inquirer.prompt([
    {
      type: field.kind === 'secret' ? 'password' : 'input',
      name: 'value',
      message: `Set ${provider.displayName} ${field.label}${field.optional ? ' (optional)' : ''}:`,
      default: field.kind === 'secret' ? '' : currentValue,
      mask: field.kind === 'secret' ? '*' : undefined,
      validate: (input: string) => validateProviderInput(field, input),
    },
  ]);

  const nextValue = typeof value === 'string' ? value.trim() : '';
  upsertCredentialForEndpoint(provider.endpointId, {
    [field.key]: nextValue.length > 0 ? nextValue : undefined,
  });
}

async function configureProvider(provider: ProviderConfigDefinition): Promise<void> {
  let keepEditing = true;

  while (keepEditing) {
    const credential = getCredentialForEndpoint(provider.endpointId);
    const fieldChoices = provider.fields.map((field) => ({
      name: `${field.label}: ${formatProviderFieldValue(field, credential)}`,
      value: field.key,
    }));

    const { fieldKey } = await inquirer.prompt([
      {
        type: 'select',
        name: 'fieldKey',
        message: `Configure ${provider.displayName}:`,
        choices: [
          ...fieldChoices,
          { name: '<- Back to provider list', value: '__back' },
        ],
      },
    ]);

    if (fieldKey === '__back') {
      keepEditing = false;
      continue;
    }

    const selectedField = provider.fields.find((field) => field.key === fieldKey);
    if (!selectedField) {
      continue;
    }

    await promptAndUpdateProviderField(provider, selectedField, credential);
    console.log(chalk.green(`✓ Updated ${provider.displayName} ${selectedField.label}`));
    console.log();
  }
}

async function configureProviders(): Promise<void> {
  const providers = getProviderConfigDefinitions();

  if (providers.length === 0) {
    console.log(chalk.yellow('\nNo configurable providers found.\n'));
    return;
  }

  let continueConfig = true;

  while (continueConfig) {
    const choices = providers.map((provider) => {
      const credential = getCredentialForEndpoint(provider.endpointId);
      const state = credential.enabled === true ? chalk.green('enabled') : chalk.gray('disabled');
      return {
        name: `${provider.displayName} (${state})`,
        value: provider.endpointId,
      };
    });

    const { endpointId } = await inquirer.prompt([
      {
        type: 'select',
        name: 'endpointId',
        message: 'Select a provider to configure:',
        choices: [
          ...choices,
          { name: '✓ Done', value: '__done' },
        ],
      },
    ]);

    if (endpointId === '__done') {
      continueConfig = false;
      continue;
    }

    const selectedProvider = providers.find((provider) => provider.endpointId === endpointId);
    if (!selectedProvider) {
      continue;
    }

    await configureProvider(selectedProvider);
  }

  console.log(chalk.green('\n✓ Provider credential configuration updated.\n'));
}

export async function listAccounts(): Promise<void> {
  const allAccounts = accountManagerV2.listAccounts();
  const config = accountManagerV2.getConfig();
  const strategy = config.strategy;

  const codexAccounts = allAccounts.filter(a => a.provider === 'codex');
  const antigravityAccounts = allAccounts.filter(a => a.provider === 'antigravity');
  const openaiCompatibleAccounts = allAccounts.filter(a => a.provider === 'openai-compatible');
  const oauthEnabled = accountManagerV2.isAuthenticated('codex');
  const enabledCredentialProviders = listEnabledCredentialProviders();
  const openaiCompatibleProvider = enabledCredentialProviders.find((provider) => provider.id === 'openai-compatible');
  const otherCredentialProviders = enabledCredentialProviders.filter((provider) => provider.id !== 'openai-compatible');

  const hasAnyEnabledProvider =
    oauthEnabled ||
    enabledCredentialProviders.length > 0 ||
    antigravityAccounts.length > 0;

  if (!hasAnyEnabledProvider && allAccounts.length === 0) {
    console.log(chalk.yellow('\nNo enabled providers found. Run `pb auth login` or configure credentials with `enabled: true`.\n'));
    return;
  }
  
  console.log(chalk.cyan(`\n📋 Accounts (${allAccounts.length} total) - Strategy: ${chalk.bold(strategy)}\n`));
  console.log(chalk.white('Enabled providers:'), hasAnyEnabledProvider ? chalk.green('✓ Found') : chalk.red('✗ None'));

  if (oauthEnabled) {
    console.log(chalk.blue.bold('\n- OpenAI OAuth'));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
  }

  if (openaiCompatibleProvider) {
    console.log(chalk.yellow.bold('\n- OpenAI-Compatible'));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
    if (openaiCompatibleProvider.maskedApiKey) {
      console.log(chalk.white('  API Key:'), chalk.gray(openaiCompatibleProvider.maskedApiKey));
    }
  }

  if (antigravityAccounts.length > 0) {
    console.log(chalk.magenta.bold('\n- Google Antigravity'));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
  }

  for (const provider of otherCredentialProviders) {
    console.log(chalk.cyan(`\n- ${provider.name}`));
    console.log(chalk.white('  Status:'), chalk.green('Enabled'));
    if (provider.maskedApiKey) {
      console.log(chalk.white('  API Key:'), chalk.gray(provider.maskedApiKey));
    }
  }

  console.log();
  
  if (codexAccounts.length > 0) {
    console.log(chalk.blue.bold('OpenAI Codex') + chalk.gray(` (${codexAccounts.length})`));
    console.log(chalk.gray('─'.repeat(50)));
    
    codexAccounts.forEach((account, index) => {
      const codexAccount = account as CodexAccount;
      const isCurrent = config.currentAccountId === account.id;
      const prefix = isCurrent ? chalk.green('➤') : ' ';
      const label = isCurrent ? chalk.green.bold(account.email || account.userId || 'Unknown') : chalk.white(account.email || account.userId || 'Unknown');
      
      console.log(`${prefix} ${index + 1}. ${label}`);
      console.log(`     ID: ${chalk.gray(account.id)}`);
      console.log(`     Added: ${chalk.gray(new Date(account.addedAt).toLocaleString())}`);
      
      if (codexAccount.expiresAt) {
        const expired = codexAccount.expiresAt < Date.now();
        const expireText = expired ? chalk.red('Expired') : chalk.green('Valid');
        console.log(`     Status: ${expireText} (expires ${new Date(codexAccount.expiresAt).toLocaleString()})`);
      }
      console.log();
    });
  }
  
  if (antigravityAccounts.length > 0) {
    console.log(chalk.magenta.bold('Google Antigravity') + chalk.gray(` (${antigravityAccounts.length})`));
    console.log(chalk.gray('─'.repeat(50)));
    
    antigravityAccounts.forEach((account, index) => {
      const antigravityAccount = account as AntigravityAccount;
      const isCurrent = config.currentAccountId === account.id;
      const prefix = isCurrent ? chalk.green('➤') : ' ';
      const label = isCurrent ? chalk.green.bold(account.email || 'Unknown') : chalk.white(account.email || 'Unknown');
      
      console.log(`${prefix} ${index + 1}. ${label}`);
      console.log(`     ID: ${chalk.gray(account.id)}`);
      console.log(`     Added: ${chalk.gray(new Date(account.addedAt).toLocaleString())}`);
      
      if (antigravityAccount.projectId) {
        console.log(`     Project: ${chalk.gray(antigravityAccount.projectId)}`);
      }
      console.log();
    });
  }
  
  if (openaiCompatibleAccounts.length > 0) {
    console.log(chalk.yellow.bold('OpenAI-Compatible API') + chalk.gray(` (${openaiCompatibleAccounts.length})`));
    console.log(chalk.gray('─'.repeat(50)));
    
    openaiCompatibleAccounts.forEach((account, index) => {
      const compatAccount = account as OpenAICompatibleAccount;
      const isCurrent = config.currentAccountId === account.id;
      const prefix = isCurrent ? chalk.green('➤') : ' ';
      const label = isCurrent ? chalk.green.bold(account.email || account.userId || 'API Key Account') : chalk.white(account.email || account.userId || 'API Key Account');
      
      console.log(`${prefix} ${index + 1}. ${label}`);
      console.log(`     ID: ${chalk.gray(account.id)}`);
      console.log(`     Added: ${chalk.gray(new Date(account.addedAt).toLocaleString())}`);
      
      if (compatAccount.baseURL) {
        console.log(`     Base URL: ${chalk.gray(compatAccount.baseURL)}`);
      } else {
        console.log(`     Base URL: ${chalk.gray('https://api.openai.com/v1 (default)')}`);
      }
      console.log();
    });
  }
  
  if (strategy === 'stick' && config.currentAccountId) {
    console.log(chalk.gray('Currently using the account marked with ➤'));
  } else if (strategy === 'round-robin') {
    console.log(chalk.gray('Round-robin mode: requests will rotate through accounts within the same provider'));
  } else if (strategy === 'hybrid') {
    console.log(chalk.gray('Hybrid mode: intelligent account selection based on health score and token availability'));
  }
  console.log();
}

async function switchAccount(identifier?: string): Promise<void> {
  let targetIdentifier = identifier;

  if (!targetIdentifier) {
    const accounts = accountManagerV2.listAccounts();

    if (accounts.length === 0) {
      console.log(chalk.yellow('\nNo accounts available. Run `pb auth login` first.\n'));
      process.exit(1);
    }

    const config = accountManagerV2.getConfig();
    const choices = accounts.map((account: Account) => {
      const providerLabel = getAccountProviderLabel(account.provider);
      const accountLabel = account.email || account.userId || account.id;
      const isCurrent = config.currentAccountId === account.id;
      const marker = isCurrent ? chalk.green('✓ ') : '';
      return {
        name: `${marker}${providerLabel} - ${accountLabel}`,
        value: account.id,
      };
    });

    const { selectedAccountId } = await inquirer.prompt([
      {
        type: 'select',
        name: 'selectedAccountId',
        message: 'Select an account to switch to:',
        choices,
      },
    ]);

    targetIdentifier = selectedAccountId;
  }

  if (!targetIdentifier) {
    console.log(chalk.red('\n✗ No account selected\n'));
    process.exit(1);
  }

  const success = accountManagerV2.setCurrentAccount(targetIdentifier);
  
  if (!success) {
    console.log(chalk.red(`\n✗ Account not found: ${targetIdentifier}`));
    console.log(chalk.yellow('Run `pb auth list` to see available accounts\n'));
    process.exit(1);
  }
  
  const account = accountManagerV2.getAccount(targetIdentifier);
  const providerLabel = account ? getAccountProviderLabel(account.provider) : 'Unknown provider';
  console.log(chalk.green(`\n✓ Switched to account: ${account?.email || account?.userId || account?.id}`));
  console.log(chalk.gray(`  Provider: ${providerLabel}`));
  console.log(chalk.gray('  Strategy set to: stick'));
  console.log();
}

async function removeAccount(identifier: string): Promise<void> {
  const account = accountManagerV2.getAccount(identifier, 'codex');
  
  if (!account) {
    console.log(chalk.red(`\n✗ Account not found: ${identifier}`));
    console.log(chalk.yellow('Run `pb auth list` to see available accounts\n'));
    process.exit(1);
  }
  
  const success = accountManagerV2.removeAccount(identifier);
  
  if (success) {
    console.log(chalk.green(`\n✓ Removed account: ${account.email || account.userId}`));
    
    const remaining = accountManagerV2.listAccounts('codex');
    if (remaining.length > 0) {
      console.log(chalk.gray(`  ${remaining.length} account${remaining.length > 1 ? 's' : ''} remaining`));
    } else {
      console.log(chalk.yellow('  No accounts remaining. Run `pb auth login` to add an account'));
    }
    console.log();
  }
}

async function setStrategy(strategy: string): Promise<void> {
  if (strategy !== 'stick' && strategy !== 'round-robin') {
    console.log(chalk.red(`\n✗ Invalid strategy: ${strategy}`));
    console.log(chalk.yellow('Valid strategies: stick, round-robin\n'));
    process.exit(1);
  }
  
  accountManagerV2.setStrategy(strategy as 'stick' | 'round-robin');
  console.log(chalk.green(`\n✓ Load balancing strategy set to: ${chalk.bold(strategy)}`));
  
  if (strategy === 'stick') {
    const current = accountManagerV2.getCurrentAccount('codex');
    if (current) {
      console.log(chalk.gray(`  Using account: ${current.email || current.userId}`));
    }
  } else {
    const accounts = accountManagerV2.listAccounts('codex');
    console.log(chalk.gray(`  Requests will rotate through ${accounts.length} account${accounts.length > 1 ? 's' : ''}`));
  }
  console.log();
}

export const authCommand = new Command('auth')
  .description('Authentication commands');

authCommand
  .command('login')
  .description('Login to an AI provider')
  .action(async () => {
    try {
      const { provider } = await inquirer.prompt([
        {
          type: 'select',
          name: 'provider',
          message: 'Select a provider to authenticate with:',
          choices: [
            { name: '🤖 OpenAI Codex (OAuth)', value: 'codex' },
            { name: '🔑 OpenAI-Compatible API (API Key)', value: 'openai-compatible' },
          ],
        },
      ]);

      if (provider === 'codex') {
        let continueAdding = true;
        
        while (continueAdding) {
          await loginWithOAuth();
          
          const { action } = await inquirer.prompt([
            {
              type: 'select',
              name: 'action',
              message: 'What would you like to do next?',
              choices: [
                { name: 'Add another OpenAI Codex account', value: 'add' },
                { name: 'Done and exit', value: 'exit' },
              ],
            },
          ]);
          
          if (action === 'exit') {
            continueAdding = false;
            console.log();
            console.log(chalk.green('Done. You can now use your Codex accounts.'));
            console.log();
          } else {
            console.log('\n');
          }
        }
      } else if (provider === 'openai-compatible') {
        await loginWithAPIKey();
      }
    } catch (error) {
      console.error(chalk.red(`Login failed: ${(error as Error).message}`));
      process.exit(1);
    }
  });

authCommand
  .command('logout')
  .description('Logout and clear credentials')
  .action(logout);

authCommand
  .command('whoami')
  .description('Show current user information')
  .action(whoami);

authCommand
  .command('list')
  .description('List all authenticated accounts')
  .action(listAccounts);

authCommand
  .command('switch [identifier]')
  .description('Switch active account (interactive menu by default)')
  .action(switchAccount);

authCommand
  .command('config')
  .description('Configure provider credentials with an interactive wizard')
  .action(configureProviders);

authCommand
  .command('remove <identifier>')
  .description('Remove an account (email, userId, or account ID)')
  .action(removeAccount);

authCommand
  .command('set-strategy <strategy>')
  .description('Set load balancing strategy (stick or round-robin)')
  .action(setStrategy);
