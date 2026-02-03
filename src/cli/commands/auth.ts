import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import inquirer from 'inquirer';
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { accountManagerV2 } from '../lib/auth-manager-v2.js';
import { antigravityAuthCommand } from './auth-antigravity.js';
import type { CodexAccount } from '../lib/account-types.js';

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
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>Authentication Failed</h1>
              <p>Error: ${error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        server.close();
        spinner.fail('Authentication failed');
        reject(new Error(error));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch - possible CSRF attack');
        server.close();
        spinner.fail('State validation failed');
        reject(new Error('State mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        server.close();
        spinner.fail('Missing authorization code');
        reject(new Error('Missing code'));
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

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h1>✓ Authentication Successful!</h1>
              <p>You can now close this window and return to the terminal.</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
        `);

        server.close();
        spinner.succeed('Successfully authenticated!');
        
        const accounts = accountManagerV2.listAccounts('codex');
        console.log(chalk.green(`\n✓ Logged in as: ${email || userId || 'User'}`));
        console.log(chalk.cyan(`✓ Account added (${accounts.length} total account${accounts.length > 1 ? 's' : ''})\n`));
        
        if (accounts.length === 1) {
          console.log(chalk.gray('  This is your first account and will be used by default\n'));
        } else {
          console.log(chalk.gray(`  Use 'pb auth switch ${email}' to make this the active account`));
          console.log(chalk.gray(`  Use 'pb auth list' to see all accounts`));
        }
        
        resolve();
      } catch (error) {
        res.writeHead(500);
        res.end('Internal server error');
        server.close();
        spinner.fail('Token exchange failed');
        reject(error);
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
    setTimeout(() => {
      server.close();
      spinner.fail('Authentication timeout (2 minutes)');
      reject(new Error('Timeout'));
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

async function listAccounts(): Promise<void> {
  const allAccounts = accountManagerV2.listAccounts();
  const config = accountManagerV2.getConfig();
  const strategy = config.strategy;
  
  if (allAccounts.length === 0) {
    console.log(chalk.yellow('\nNo accounts found. Run `pb auth login` or `pb auth antigravity login` to add an account.\n'));
    return;
  }
  
  const codexAccounts = allAccounts.filter(a => a.provider === 'codex');
  const antigravityAccounts = allAccounts.filter(a => a.provider === 'antigravity');
  const openaiCompatibleAccounts = allAccounts.filter(a => a.provider === 'openai-compatible');
  
  console.log(chalk.cyan(`\n📋 Accounts (${allAccounts.length} total) - Strategy: ${chalk.bold(strategy)}\n`));
  
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
      const antigravityAccount = account as any;
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
      const compatAccount = account as any;
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

async function switchAccount(identifier: string): Promise<void> {
  const success = accountManagerV2.setCurrentAccount(identifier);
  
  if (!success) {
    console.log(chalk.red(`\n✗ Account not found: ${identifier}`));
    console.log(chalk.yellow('Run `pb auth list` to see available accounts\n'));
    process.exit(1);
  }
  
  const account = accountManagerV2.getAccount(identifier, 'codex');
  console.log(chalk.green(`\n✓ Switched to account: ${account?.email || account?.userId}`));
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
            { name: '🔮 Google Antigravity (OAuth)', value: 'antigravity' },
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
                { name: '➕ Add another OpenAI Codex account', value: 'add' },
                { name: '✓ Done, exit', value: 'exit' },
              ],
            },
          ]);
          
          if (action === 'exit') {
            continueAdding = false;
            console.log(chalk.green('\n✓ All done! You can now use your Codex accounts.\n'));
          } else {
            console.log('\n');
          }
        }
      } else if (provider === 'antigravity') {
        const { loginAntigravity } = await import('./auth-antigravity.js');
        let continueAdding = true;
        
        while (continueAdding) {
          await loginAntigravity();
          
          const { action } = await inquirer.prompt([
            {
              type: 'select',
              name: 'action',
              message: 'What would you like to do next?',
              choices: [
                { name: '➕ Add another Antigravity account', value: 'add' },
                { name: '✓ Done, exit', value: 'exit' },
              ],
            },
          ]);
          
          if (action === 'exit') {
            continueAdding = false;
            console.log(chalk.green('\n✓ All done! You can now use your Antigravity accounts.\n'));
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
  .command('switch <identifier>')
  .description('Switch to a specific account (email, userId, or account ID)')
  .action(switchAccount);

authCommand
  .command('remove <identifier>')
  .description('Remove an account (email, userId, or account ID)')
  .action(removeAccount);

authCommand
  .command('set-strategy <strategy>')
  .description('Set load balancing strategy (stick or round-robin)')
  .action(setStrategy);

authCommand.addCommand(antigravityAuthCommand);
