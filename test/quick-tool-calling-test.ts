#!/usr/bin/env node
/**
 * Quick Tool Calling Test
 * 快速测试原生 tool calling 功能
 *
 * Usage: npm run test:tool-calling
 */

import { getLLMService } from '../src/infra/llm/llm-service.js';
import { getGlobalToolProvider } from '../src/infra/tools/tool-provider.js';
import type { LLMMessage } from '../src/infra/llm/llm-provider.js';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(color: string, ...args: any[]) {
  console.log(color, ...args, COLORS.reset);
}

async function quickTest() {
  log(COLORS.bright + COLORS.cyan, '\n🧪 Quick Tool Calling Test\n');

  const llmService = getLLMService();
  const toolProvider = getGlobalToolProvider();

  // Get conversation tools
  const allTools = toolProvider.getToolDefinitions();
  const conversationTools = allTools.filter(tool =>
    ['web_search', 'find_skills'].includes(tool.name)
  );

  log(COLORS.blue, `📦 Available tools: ${conversationTools.map(t => t.name).join(', ')}\n`);

  // Test: Tool calling
  log(COLORS.bright, '=== Testing Tool Calling ===\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant with access to web search. When asked about current information, use the web_search tool.',
    },
    {
      role: 'user',
      content: 'What is the weather like in Shanghai today?',
    },
  ];

  try {
    log(COLORS.yellow, '📤 Sending request to LLM...');

    const response = await llmService.completeForAgent('conversation', messages, {
      maxTokens: 500,
      tools: conversationTools,
      tool_choice: 'auto',
      thinking: true,
    });

    log(COLORS.green, '\n✅ Response received!\n');

    // Display results
    console.log('📊 Response Details:');
    console.log('  Model:', response.model || 'unknown');
    console.log('  Tokens used:', response.tokensUsed);
    console.log('  Finish reason:', response.finishReason);

    if (response.thinking) {
      log(COLORS.cyan, '\n💭 Thinking Process:');
      console.log('  ', response.thinking.substring(0, 150) + '...');
    }

    if (response.content) {
      log(COLORS.cyan, '\n💬 Content:');
      console.log('  ', response.content);
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      log(COLORS.green, '\n🔧 Tool Calls Detected:');
      for (const toolCall of response.toolCalls) {
        console.log(`  ✓ ${toolCall.function.name}`);
        console.log(`    ID: ${toolCall.id}`);
        console.log(`    Arguments: ${toolCall.function.arguments}`);

        // Parse and display arguments nicely
        try {
          const args = JSON.parse(toolCall.function.arguments);
          console.log('    Parsed:', JSON.stringify(args, null, 2).split('\n').join('\n    '));
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Simulate tool execution
      log(COLORS.yellow, '\n🔄 Simulating tool execution...');

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.toolCalls,
      });

      // Add mock tool results
      for (const toolCall of response.toolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        const mockResult = `Mock search results for "${args.query}": Weather in Shanghai is 25°C, sunny with light clouds. Air quality is good.`;

        messages.push({
          role: 'tool',
          content: mockResult,
          tool_call_id: toolCall.id,
        });

        console.log(`  ✓ Executed ${toolCall.function.name}`);
      }

      // Get final response
      log(COLORS.yellow, '\n📤 Sending tool results back to LLM...');

      const finalResponse = await llmService.completeForAgent('conversation', messages, {
        maxTokens: 500,
        tools: conversationTools,
        tool_choice: 'auto',
      });

      log(COLORS.green, '\n✅ Final response received!\n');

      console.log('📊 Final Response:');
      console.log('  Tokens used:', finalResponse.tokensUsed);
      console.log('  Finish reason:', finalResponse.finishReason);

      if (finalResponse.content) {
        log(COLORS.cyan, '\n💬 Final Content:');
        console.log('  ', finalResponse.content);
      }
    } else {
      log(COLORS.yellow, '\n⚠️  No tool calls detected');
      console.log('  The model may have responded directly without using tools.');
      console.log('  This could happen if:');
      console.log('    - The model decided it could answer without tools');
      console.log('    - The tool definitions were not clear enough');
      console.log('    - The model does not support tool calling');
    }

    log(COLORS.green, '\n✅ Test completed successfully!\n');

  } catch (error) {
    log(COLORS.red, '\n❌ Test failed!\n');
    console.error('Error:', error);
    console.error('\nPossible issues:');
    console.error('  - API keys not configured in ~/.ponybunny/credentials.json');
    console.error('  - Model not available or not configured in llm-config.json');
    console.error('  - Network connectivity issues');
    process.exit(1);
  }
}

// Run the test
quickTest().catch((error) => {
  log(COLORS.red, '\n❌ Unexpected error!\n');
  console.error(error);
  process.exit(1);
});
