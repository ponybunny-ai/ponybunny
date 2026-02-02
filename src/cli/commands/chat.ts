import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { gatewayClient } from '../lib/gateway-client.js';
import type { ChatMessage } from '../lib/gateway-client.js';

interface ChatOptions {
  model?: string;
  system?: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const model = options.model || 'gpt-5.2';
  
  console.log(chalk.cyan(`\n🤖 PonyBunny Chat (Model: ${model})`));
  console.log(chalk.gray('Type your message and press Enter. Type "exit" to quit.\n'));

  const messages: ChatMessage[] = [];
  
  if (options.system) {
    messages.push({
      role: 'system',
      content: options.system,
    });
  }

  while (true) {
    const { userMessage } = await inquirer.prompt([
      {
        type: 'input',
        name: 'userMessage',
        message: chalk.green('You:'),
        prefix: '',
      },
    ]);

    if (!userMessage.trim()) {
      continue;
    }

    if (userMessage.toLowerCase() === 'exit') {
      console.log(chalk.cyan('\n👋 Goodbye!\n'));
      break;
    }

    messages.push({
      role: 'user',
      content: userMessage,
    });

    try {
      console.log(chalk.blue('\nAssistant: '), { write: true } as any);
      
      let assistantMessage = '';
      
      await gatewayClient.streamChatCompletion(
        {
          model,
          messages,
        },
        (chunk) => {
          process.stdout.write(chunk);
          assistantMessage += chunk;
        }
      );
      
      console.log('\n');

      messages.push({
        role: 'assistant',
        content: assistantMessage,
      });

    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
      
      messages.pop();
    }
  }
}
