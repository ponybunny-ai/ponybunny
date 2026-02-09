/**
 * E2E Tool Calling Demo
 * Demonstrates native tool calling with real LLM providers
 *
 * Run with: npx tsx test/e2e/tool-calling-demo.ts
 */

import { getLLMService } from '../../src/infra/llm/llm-service.js';
import { getGlobalToolProvider } from '../../src/infra/tools/tool-provider.js';
import type { LLMMessage } from '../../src/infra/llm/llm-provider.js';

async function main() {
  console.log('🚀 Tool Calling Demo\n');

  const llmService = getLLMService();
  const toolProvider = getGlobalToolProvider();

  // Get tool definitions
  const tools = toolProvider.getToolDefinitions();
  const conversationTools = tools.filter(tool =>
    ['web_search', 'find_skills'].includes(tool.name)
  );

  console.log(`📦 Available tools: ${conversationTools.map(t => t.name).join(', ')}\n`);

  // Test 1: Simple conversation without tools
  console.log('=== Test 1: Simple Conversation ===');
  const messages1: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello! How are you?' },
  ];

  try {
    const response1 = await llmService.completeForAgent('conversation', messages1, {
      maxTokens: 500,
    });

    console.log('Response:', response1.content);
    console.log('Tokens used:', response1.tokensUsed);
    console.log('Finish reason:', response1.finishReason);
    console.log();
  } catch (error) {
    console.error('Error:', error);
  }

  // Test 2: Conversation that should trigger tool calling
  console.log('=== Test 2: Tool Calling (Web Search) ===');
  const messages2: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant with access to web search.' },
    { role: 'user', content: 'What is the weather like in London today?' },
  ];

  try {
    console.log('\n📤 Request details:');
    console.log('  Agent: conversation');
    console.log('  Messages:', JSON.stringify(messages2, null, 2));
    console.log('  Options:', JSON.stringify({
      maxTokens: 500,
      tools: conversationTools.map(t => ({ name: t.name, description: t.description })),
      tool_choice: 'auto',
    }, null, 2));

    const response2 = await llmService.completeForAgent('conversation', messages2, {
      maxTokens: 500,
      tools: conversationTools,
      tool_choice: 'auto',
    });

    console.log('\n📥 Response content:', response2.content);
    console.log('Tokens used:', response2.tokensUsed);
    console.log('Finish reason:', response2.finishReason);

    if (response2.toolCalls && response2.toolCalls.length > 0) {
      console.log('\n🔧 Tool calls detected:');
      for (const toolCall of response2.toolCalls) {
        console.log(`  - ${toolCall.function.name}`);
        console.log(`    Arguments: ${toolCall.function.arguments}`);
      }
    } else {
      console.log('\n⚠️  No tool calls detected (model may have responded directly)');
    }
    console.log();
  } catch (error) {
    console.error('Error:', error);
  }

  // Test 3: Multi-turn conversation with tool execution
  console.log('=== Test 3: Multi-turn with Tool Execution ===');
  const messages3: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant with access to web search.' },
    { role: 'user', content: 'Search for the latest news about AI' },
  ];

  try {
    // First call - should request tool use
    const response3a = await llmService.completeForAgent('conversation', messages3, {
      maxTokens: 500,
      tools: conversationTools,
      tool_choice: 'auto',
    });

    console.log('First response:');
    console.log('  Content:', response3a.content);
    console.log('  Finish reason:', response3a.finishReason);

    if (response3a.toolCalls && response3a.toolCalls.length > 0) {
      console.log('\n🔧 Tool calls:');

      // Add assistant message with tool calls
      messages3.push({
        role: 'assistant',
        content: response3a.content,
        tool_calls: response3a.toolCalls,
      });

      // Execute tools (mock)
      for (const toolCall of response3a.toolCalls) {
        console.log(`  - Executing ${toolCall.function.name}...`);
        const args = JSON.parse(toolCall.function.arguments);
        const mockResult = `Mock search results for "${args.query}": Latest AI developments include...`;

        messages3.push({
          role: 'tool',
          content: mockResult,
          tool_call_id: toolCall.id,
        });
      }

      // Second call - with tool results
      console.log('\n📥 Sending tool results back to LLM...');
      const response3b = await llmService.completeForAgent('conversation', messages3, {
        maxTokens: 500,
        tools: conversationTools,
        tool_choice: 'auto',
      });

      console.log('\nFinal response:');
      console.log('  Content:', response3b.content);
      console.log('  Finish reason:', response3b.finishReason);
    }
    console.log();
  } catch (error) {
    console.error('Error:', error);
  }

  // Test 4: Thinking mode (if supported)
  console.log('=== Test 4: Thinking Mode ===');
  const messages4: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain the concept of recursion in programming.' },
  ];

  try {
    const response4 = await llmService.completeForAgent('conversation', messages4, {
      maxTokens: 1000,
      thinking: true,
    });

    console.log('Response:', response4.content);
    console.log('Tokens used:', response4.tokensUsed);

    if (response4.thinking) {
      console.log('\n💭 Thinking process:');
      console.log(response4.thinking.substring(0, 200) + '...');
    } else {
      console.log('\n⚠️  No thinking content (model may not support this feature)');
    }
    console.log();
  } catch (error) {
    console.error('Error:', error);
  }

  console.log('✅ Demo completed!');
}

main().catch(console.error);
