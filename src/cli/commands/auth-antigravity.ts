import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { createServer } from 'http';
import { accountManagerV2 } from '../lib/auth-manager-v2.js';
import { authorizeAntigravity, exchangeAntigravityCode } from '../lib/antigravity-oauth.js';
import { ANTIGRAVITY_REDIRECT_URI } from '../lib/antigravity-constants.js';

const CALLBACK_URL = new URL(ANTIGRAVITY_REDIRECT_URI);

async function loginAntigravity(): Promise<void> {
  const spinner = ora('Initializing Antigravity OAuth login...').start();
  const { url, state } = authorizeAntigravity();

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith(CALLBACK_URL.pathname)) {
        res.writeHead(404);
        res.end();
        return;
      }

      const callbackUrl = new URL(req.url, ANTIGRAVITY_REDIRECT_URI);
      const code = callbackUrl.searchParams.get('code');
      const returnedState = callbackUrl.searchParams.get('state');
      const error = callbackUrl.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Authentication Failed</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%);
                }
                .container {
                  background: white;
                  padding: 3rem;
                  border-radius: 1rem;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                  text-align: center;
                  max-width: 400px;
                }
                .error-icon {
                  font-size: 4rem;
                  color: #ef4444;
                  margin-bottom: 1rem;
                }
                h1 {
                  color: #1f2937;
                  margin: 0 0 1rem 0;
                  font-size: 1.5rem;
                }
                p {
                  color: #6b7280;
                  margin: 0;
                  line-height: 1.6;
                }
                .error-details {
                  background: #fef2f2;
                  padding: 1rem;
                  border-radius: 0.5rem;
                  margin-top: 1rem;
                  color: #991b1b;
                  font-family: monospace;
                  font-size: 0.875rem;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="error-icon">✗</div>
                <h1>Authentication Failed</h1>
                <p>An error occurred during authentication.</p>
                <div class="error-details">${error}</div>
                <p style="margin-top: 1rem;">You can close this window.</p>
              </div>
            </body>
          </html>
        `);
        server.close();
        spinner.fail('Authentication failed');
        reject(new Error(error));
        return;
      }

      if (!returnedState || returnedState !== state) {
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
        const result = await exchangeAntigravityCode(code, returnedState);
        if (result.type === 'failed') {
          throw new Error(result.error);
        }

        const account = accountManagerV2.addAntigravityAccount({
          refreshToken: result.refreshToken,
          email: result.email,
          projectId: result.projectId,
          managedProjectId: result.managedProjectId,
          rateLimitResetTimes: {},
          fingerprint: undefined,
          userId: undefined,
        });

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Antigravity Authentication Successful</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }
                .container {
                  background: white;
                  padding: 3rem;
                  border-radius: 1rem;
                  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                  text-align: center;
                  max-width: 400px;
                }
                .success-icon {
                  font-size: 4rem;
                  color: #10b981;
                  margin-bottom: 1rem;
                }
                h1 {
                  color: #1f2937;
                  margin: 0 0 1rem 0;
                  font-size: 1.5rem;
                }
                p {
                  color: #6b7280;
                  margin: 0;
                  line-height: 1.6;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="success-icon">✓</div>
                <h1>Authentication Successful!</h1>
                <p>You can now close this window and return to the terminal.</p>
              </div>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
        `);

        server.close();
        spinner.succeed('Successfully authenticated with Antigravity!');

        const accounts = accountManagerV2.listAccounts('antigravity');
        console.log(chalk.green(`\n✓ Logged in as: ${account.email || 'Unknown'}`));
        console.log(chalk.cyan(`✓ Antigravity account added (${accounts.length} total)`));
        resolve();
      } catch (err) {
        res.writeHead(500);
        res.end('Internal server error');
        server.close();
        spinner.fail('Token exchange failed');
        reject(err);
      }
    });

    const port = Number(CALLBACK_URL.port || '51121');
    server.listen(port, () => {
      spinner.succeed(`OAuth server started on port ${port}`);
      console.log(chalk.cyan('\nOpening browser for Antigravity authentication...'));
      console.log(chalk.gray(`If browser doesn't open, visit: ${url}\n`));

      open(url).catch(() => {
        console.log(chalk.yellow(`Please manually open: ${url}`));
      });
    });

    setTimeout(() => {
      server.close();
      spinner.fail('Authentication timeout (2 minutes)');
      reject(new Error('Timeout'));
    }, 120000);
  });
}

async function listAntigravityAccounts(): Promise<void> {
  const accounts = accountManagerV2.listAccounts('antigravity');
  if (accounts.length === 0) {
    console.log(chalk.yellow('\nNo Antigravity accounts found. Run `pb auth antigravity login` to add one.\n'));
    return;
  }

  console.log(chalk.cyan(`\n📋 Antigravity Accounts (${accounts.length} total)\n`));
  accounts.forEach((account, index) => {
    const antigravityAccount = account.provider === 'antigravity' ? account : undefined;
    console.log(`${index + 1}. ${chalk.white(account.email || 'Unknown')}`);
    console.log(`     ID: ${chalk.gray(account.id)}`);
    console.log(`     Added: ${chalk.gray(new Date(account.addedAt).toLocaleString())}`);
    if (antigravityAccount?.projectId) {
      console.log(`     Project: ${chalk.gray(antigravityAccount.projectId)}`);
    }
    console.log();
  });
}

async function removeAntigravityAccount(identifier: string): Promise<void> {
  const account = accountManagerV2.getAccount(identifier, 'antigravity');
  if (!account) {
    console.log(chalk.red(`\n✗ Antigravity account not found: ${identifier}`));
    console.log(chalk.yellow('Run `pb auth antigravity list` to see available accounts\n'));
    process.exit(1);
  }

  const success = accountManagerV2.removeAccount(identifier);
  if (success) {
    console.log(chalk.green(`\n✓ Removed Antigravity account: ${account.email || account.id}`));
    const remaining = accountManagerV2.listAccounts('antigravity');
    if (remaining.length === 0) {
      console.log(chalk.yellow('  No Antigravity accounts remaining. Run `pb auth antigravity login` to add one'));
    } else {
      console.log(chalk.gray(`  ${remaining.length} Antigravity account${remaining.length > 1 ? 's' : ''} remaining`));
    }
    console.log();
  }
}

export const antigravityAuthCommand = new Command('antigravity')
  .description('Antigravity authentication commands');

antigravityAuthCommand
  .command('login')
  .description('Login with Antigravity (Google) OAuth')
  .action(async () => {
    try {
      await loginAntigravity();
    } catch (error) {
      console.error(chalk.red(`Login failed: ${(error as Error).message}`));
      process.exit(1);
    }
  });

antigravityAuthCommand
  .command('list')
  .description('List Antigravity accounts')
  .action(listAntigravityAccounts);

antigravityAuthCommand
  .command('remove <identifier>')
  .description('Remove an Antigravity account (email or account ID)')
  .action(removeAntigravityAccount);
