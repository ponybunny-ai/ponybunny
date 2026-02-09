/**
 * Tool Calling Protocol Adapter Tests
 */

import { describe, it, expect } from '@jest/globals';
import { AnthropicProtocolAdapter } from '../../../../src/infra/llm/protocols/anthropic-protocol.js';
import { OpenAIProtocolAdapter } from '../../../../src/infra/llm/protocols/openai-protocol.js';
import { GeminiProtocolAdapter } from '../../../../src/infra/llm/protocols/gemini-protocol.js';
import type { LLMMessage, ToolDefinition } from '../../../../src/infra/llm/llm-provider.js';

describe('Tool Calling Protocol Adapters', () => {
  const sampleTools: ToolDefinition[] = [
    {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
        },
        required: ['query'],
      },
    },
  ];

  describe('AnthropicProtocolAdapter', () => {
    const adapter = new AnthropicProtocolAdapter();

    it('should format tool definitions correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Search for weather in Shanghai' },
      ];

      const request = adapter.formatRequest(messages, {
        model: 'claude-3-5-sonnet-20241022',
        tools: sampleTools,
        tool_choice: 'auto',
      });

      expect(request).toHaveProperty('tools');
      expect((request as any).tools[0]).toHaveProperty('input_schema');
      expect((request as any).tools[0].name).toBe('web_search');
    });

    it('should format tool result messages correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Search for weather' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'toolu_123',
              type: 'function',
              function: {
                name: 'web_search',
                arguments: '{"query":"weather in Shanghai"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: 'Weather: 25°C, sunny',
          tool_call_id: 'toolu_123',
        },
      ];

      const request = adapter.formatRequest(messages, {
        model: 'claude-3-5-sonnet-20241022',
        tools: sampleTools,
      });

      const anthropicMessages = (request as any).messages;
      expect(anthropicMessages).toHaveLength(3);

      // Check tool result format
      const toolResultMsg = anthropicMessages[2];
      expect(toolResultMsg.role).toBe('user');
      expect(toolResultMsg.content[0].type).toBe('tool_result');
      expect(toolResultMsg.content[0].tool_use_id).toBe('toolu_123');
    });

    it('should parse tool calls from response', () => {
      const rawResponse = {
        status: 200,
        statusText: 'OK',
        data: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'web_search',
              input: { query: 'weather in Shanghai' },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'tool_use',
        },
      };

      const response = adapter.parseResponse(rawResponse, 'claude-3-5-sonnet-20241022');

      expect(response.finishReason).toBe('tool_calls');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].function.name).toBe('web_search');
      expect(JSON.parse(response.toolCalls![0].function.arguments)).toEqual({
        query: 'weather in Shanghai',
      });
    });
  });

  describe('OpenAIProtocolAdapter', () => {
    const adapter = new OpenAIProtocolAdapter();

    it('should format tool definitions correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Search for weather in Shanghai' },
      ];

      const request = adapter.formatRequest(messages, {
        model: 'gpt-4',
        tools: sampleTools,
        tool_choice: 'auto',
      });

      expect(request).toHaveProperty('tools');
      expect((request as any).tools[0].type).toBe('function');
      expect((request as any).tools[0].function.name).toBe('web_search');
    });

    it('should parse tool calls from response', () => {
      const rawResponse = {
        status: 200,
        statusText: 'OK',
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'web_search',
                      arguments: '{"query":"weather in Shanghai"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { total_tokens: 150 },
        },
      };

      const response = adapter.parseResponse(rawResponse, 'gpt-4');

      expect(response.finishReason).toBe('tool_calls');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].function.name).toBe('web_search');
    });
  });

  describe('GeminiProtocolAdapter', () => {
    const adapter = new GeminiProtocolAdapter();

    it('should format tool definitions correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Search for weather in Shanghai' },
      ];

      const request = adapter.formatRequest(messages, {
        model: 'gemini-pro',
        tools: sampleTools,
      });

      expect(request).toHaveProperty('tools');
      expect((request as any).tools[0]).toHaveProperty('function_declarations');
      expect((request as any).tools[0].function_declarations[0].name).toBe('web_search');
    });

    it('should parse function calls from response', () => {
      const rawResponse = {
        status: 200,
        statusText: 'OK',
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'web_search',
                      args: { query: 'weather in Shanghai' },
                    },
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
          },
        },
      };

      const response = adapter.parseResponse(rawResponse, 'gemini-pro');

      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].function.name).toBe('web_search');
    });
  });
});
