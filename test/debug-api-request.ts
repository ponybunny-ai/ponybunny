#!/usr/bin/env node
/**
 * Debug API Request
 * Logs the actual API request being sent to verify tools are included
 *
 * Usage: npx tsx test/debug-api-request.ts
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
  magenta: '\x1b[35m',
};

function log(color: string, ...args: any[]) {
  console.log(color, ...args, COLORS.reset);
}

// Monkey-patch fetch to intercept API requests
const originalFetch = global.fetch;
global.fetch = async (url: any, options: any) => {
  log(COLORS.bright + COLORS.magenta, '\n🔍 Intercepted API Request:\n');

  console.log('URL:', url);
  console.log('\nHeaders:');
  if (options?.headers) {
    const headers = options.headers;
    for (const [key, value] of Object.entries(headers)) {
      // Mask API keys
      if (key.toLowerCase().includes('authorization') || key.toLowerCase().includes('api-key')) {
        console.log(`  ${key}: ${typeof value === 'string' ? value.substring(0, 20) + '...' : '[MASKED]'}`);
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }
  }

  console.log('\nRequest Body:');
  if (options?.body) {
    try {
      const body = JSON.parse(options.body);

      // Log key fields
      console.log('  model:', body.model);
      console.log('  max_tokens:', body.max_tokens || body.maxTokens);
      console.log('  temperature:', body.temperature);

      // Log messages
      console.log('\n  messages:', body.messages?.length || 0, 'messages');
      if (body.messages && body.messages.length > 0) {
        body.messages.forEach((msg: any, i: number) => {
          console.log(`    [${i}] role: ${msg.role}`);
          if (msg.content) {
            const preview = typeof msg.content === 'string'
              ? msg.content.substring(0, 100)
              : JSON.stringify(msg.content).substring(0, 100);
            console.log(`        content: ${preview}...`);
          }
        });
      }

      // Log tools - THIS IS THE KEY PART
      if (body.tools) {
        log(COLORS.green, '\n  ✅ tools:', body.tools.length, 'tools');
        body.tools.forEach((tool: any, i: number) => {
          console.log(`    [${i}] ${tool.name}: ${tool.description}`);
          if (tool.parameters || tool.input_schema) {
            const schema = tool.parameters || tool.input_schema;
            console.log(`        parameters:`, JSON.stringify(schema, null, 2).split('\n').map((line, idx) => idx === 0 ? line : '        ' + line).join('\n'));
          }
        });
      } else {
        log(COLORS.red, '\n  ❌ tools: NOT PRESENT IN REQUEST');
      }

      // Log tool_choice
      if (body.tool_choice) {
        log(COLORS.green, '\n  ✅ tool_choice:', body.tool_choice);
      } else {
        log(COLORS.yellow, '\n  ⚠️  tool_choice: NOT SET');
      }

      // Log thinking/extended_thinking
      if (body.thinking || body.extended_thinking) {
        log(COLORS.green, '\n  ✅ thinking:', body.thinking || body.extended_thinking);
      }

      // Log full body for reference
      console.log('\n  Full body:');
      console.log(JSON.stringify(body, null, 2).split('\n').map(line => '    ' + line).join('\n'));

    } catch (e) {
      console.log('  [Could not parse body as JSON]');
      console.log('  Raw body:', options.body);
    }
  }

  log(COLORS.bright + COLORS.magenta, '\n📤 Sending request to API...\n');

  // Call original fetch
  return originalFetch(url, options);
};

async function debugTest() {
  log(COLORS.bright + COLORS.cyan, '\n🔬 Debug API Request Test\n');

  const llmService = getLLMService();
  const toolProvider = getGlobalToolProvider();

  // Get conversation tools
  const allTools = toolProvider.getToolDefinitions();
  const conversationTools = allTools.filter(tool =>
    ['web_search', 'find_skills'].includes(tool.name)
  );

  log(COLORS.blue, `📦 Preparing to send ${conversationTools.length} tools to LLM\n`);

  conversationTools.forEach((tool, i) => {
    console.log(`  [${i}] ${tool.name}: ${tool.description}`);
  });

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
    log(COLORS.yellow, '\n📤 Calling LLM with tools...\n');

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
      }
    } else {
      log(COLORS.red, '\n❌ No tool calls detected');
      console.log('  The model did not use native tool calling.');
    }

    log(COLORS.green, '\n✅ Debug test completed!\n');

  } catch (error) {
    log(COLORS.red, '\n❌ Test failed!\\n');
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the test
debugTest().catch((error) => {
  log(COLORS.red, '\n❌ Unexpected error!\n');
  console.error(error);
  process.exit(1);
});
