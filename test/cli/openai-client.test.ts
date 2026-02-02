import { OpenAIClient } from '../../src/cli/lib/openai-client.js';
import { authManager } from '../../src/cli/lib/auth-manager.js';

jest.mock('../../src/cli/lib/auth-manager.js');

describe('OpenAIClient', () => {
  let client: OpenAIClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    jest.spyOn(authManager, 'getAccessToken').mockReturnValue('test-token');
    
    client = new OpenAIClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('chatCompletion', () => {
    test('makes POST request to OpenAI API with correct parameters', async () => {
      const mockResponse = {
        id: 'chat-123',
        model: 'gpt-4',
        choices: [{
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await client.chatCompletion({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(result.id).toBe('chat-123');
      expect(result.choices[0].message.content).toBe('Hello!');
    });

    test('throws error when not authenticated', async () => {
      jest.spyOn(authManager, 'getAccessToken').mockReturnValue(undefined);

      await expect(
        client.chatCompletion({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('Not authenticated');
    });

    test('throws error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        client.chatCompletion({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('OpenAI API request failed');
    });
  });
});
