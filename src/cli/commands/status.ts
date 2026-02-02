import chalk from 'chalk';
import { authManager } from '../lib/auth-manager.js';
import { gatewayClient } from '../lib/gateway-client.js';

export async function statusCommand(): Promise<void> {
  console.log(chalk.cyan('\n🔍 PonyBunny Status\n'));

  const isAuth = authManager.isAuthenticated();
  console.log(chalk.white('Authentication:'), isAuth ? chalk.green('✓ Authenticated') : chalk.red('✗ Not authenticated'));

  if (isAuth) {
    const config = authManager.getConfig();
    console.log(chalk.white('  User:'), config.email || config.userId || 'Unknown');
    console.log(chalk.white('  Gateway:'), config.gatewayUrl || 'Default');
    
    try {
      console.log(chalk.white('\nTesting API connection...'));
      const goals = await gatewayClient.listGoals();
      console.log(chalk.green(`✓ API connection successful (${goals.length} goals)`));
    } catch (error) {
      console.log(chalk.red(`✗ API connection failed: ${(error as Error).message}`));
    }
  } else {
    console.log(chalk.yellow('\nRun `pb auth login` to authenticate'));
  }
  
  console.log();
}
