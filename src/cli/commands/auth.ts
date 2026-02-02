import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { createServer } from 'http';
import { authManager } from '../lib/auth-manager.js';

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: string;
  email?: string;
}

async function loginWithOAuth(): Promise<void> {
  const spinner = ora('Initializing OAuth login...').start();
  
  const gatewayUrl = authManager.getGatewayUrl();
  const callbackPort = 8765;
  const redirectUri = `http://localhost:${callbackPort}/callback`;
  
  const authUrl = `${gatewayUrl}/oauth/authorize?` + 
    `response_type=code&` +
    `client_id=ponybunny-cli&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=openai:gpt5.2 goals:read goals:write`;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost:${callbackPort}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

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
        const tokenResponse = await fetch(`${gatewayUrl}/oauth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: 'ponybunny-cli',
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
        }

        const tokens: OAuthTokenResponse = await tokenResponse.json() as OAuthTokenResponse;

        authManager.saveConfig({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
          userId: tokens.user_id,
          email: tokens.email,
          gatewayUrl,
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
        
        console.log(chalk.green(`\n✓ Logged in as: ${tokens.email || tokens.user_id || 'User'}`));
        console.log(chalk.cyan(`✓ Access to GPT-5.2 model enabled`));
        
        resolve();
      } catch (error) {
        res.writeHead(500);
        res.end('Internal server error');
        server.close();
        spinner.fail('Token exchange failed');
        reject(error);
      }
    });

    server.listen(callbackPort, () => {
      spinner.succeed('OAuth server started');
      console.log(chalk.cyan(`\nOpening browser for authentication...`));
      console.log(chalk.gray(`If browser doesn't open, visit: ${authUrl}\n`));
      
      open(authUrl).catch(() => {
        console.log(chalk.yellow(`Please manually open: ${authUrl}`));
      });
    });

    setTimeout(() => {
      server.close();
      spinner.fail('Authentication timeout (2 minutes)');
      reject(new Error('Timeout'));
    }, 120000);
  });
}

async function logout(): Promise<void> {
  authManager.clearConfig();
  console.log(chalk.green('✓ Successfully logged out'));
}

async function whoami(): Promise<void> {
  if (!authManager.isAuthenticated()) {
    console.log(chalk.red('Not authenticated. Run `pb auth login` first.'));
    process.exit(1);
  }

  const config = authManager.getConfig();
  console.log(chalk.cyan('Authentication Status:'));
  console.log(chalk.white(`  User: ${config.email || config.userId || 'Unknown'}`));
  console.log(chalk.white(`  Gateway: ${config.gatewayUrl || 'Default'}`));
  console.log(chalk.white(`  Token expires: ${config.expiresAt ? new Date(config.expiresAt).toLocaleString() : 'Never'}`));
}

export const authCommand = new Command('auth')
  .description('Authentication commands');

authCommand
  .command('login')
  .description('Login with OAuth')
  .option('--gateway <url>', 'Gateway URL (default: https://api.ponybunny.ai)')
  .action(async (options) => {
    if (options.gateway) {
      authManager.saveConfig({ gatewayUrl: options.gateway });
    }
    
    try {
      await loginWithOAuth();
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
