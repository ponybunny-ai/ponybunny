#!/usr/bin/env node
/**
 * Simple Tool Calling Test
 * Tests if local proxy downgrades model when using tools
 */

const API_KEY = 'sk-ef06000d99774f68b29a2fb618f34164';
const BASE_URL = 'http://127.0.0.1:8972/v1/messages';

async function testWithoutTools() {
  console.log('=== Test 1: Without Tools ===\n');

  const request = {
    model: 'claude-opus-4-6-thinking',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'What is 2+2?' }
    ]
  };

  console.log('Request:', JSON.stringify(request, null, 2));

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();
  console.log('\nResponse model:', data.model);
  console.log('Content types:', data.content?.map((c: any) => c.type).join(', '));
  console.log();
}

async function testWithTools() {
  console.log('=== Test 2: With Tools ===\n');

  const request = {
    model: 'claude-opus-4-6-thinking',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'Search for weather in London' }
    ],
    tools: [
      {
        name: 'web_search',
        description: 'Search the web',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      }
    ],
    tool_choice: { type: 'auto' }
  };

  console.log('Request:', JSON.stringify(request, null, 2));

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();
  console.log('\nResponse model:', data.model);
  console.log('Content types:', data.content?.map((c: any) => c.type).join(', '));
  console.log('Stop reason:', data.stop_reason);
  console.log();
}

async function main() {
  console.log('🧪 Simple Tool Calling Test\n');
  console.log('Testing local proxy:', BASE_URL);
  console.log();

  try {
    await testWithoutTools();
    await testWithTools();
    console.log('✅ Tests completed!');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
