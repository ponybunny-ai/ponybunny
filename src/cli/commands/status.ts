import chalk from 'chalk';
import { authManager } from '../lib/auth-manager.js';
import { openaiClient } from '../lib/openai-client.js';

export async function statusCommand(): Promise<void> {
  console.log(chalk.cyan('\n🔍 PonyBunny Status\n'));

  const isAuth = authManager.isAuthenticated();
  console.log(chalk.white('Authentication:'), isAuth ? chalk.green('✓ Authenticated') : chalk.red('✗ Not authenticated'));

  if (isAuth) {
    const config = authManager.getConfig();
    console.log(chalk.white('  User:'), config.email || config.userId || 'Unknown');
    
    try {
      console.log(chalk.white('\nTesting OpenAI API connection...'));
      let response = '';
      await openaiClient.streamChatCompletion({
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: 'Say "OK"' }],
      }, (chunk) => {
        response += chunk;
      });
      console.log(chalk.green('✓ OpenAI API connection successful'));
    } catch (error) {
      console.log(chalk.red(`✗ OpenAI API connection failed: ${(error as Error).message}`));
    }
  } else {
    console.log(chalk.yellow('\nRun `pb auth login` to authenticate'));
  }
  
  console.log();
}
