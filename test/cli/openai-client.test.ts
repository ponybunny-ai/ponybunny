import { OpenAIClient } from '../../src/cli/lib/openai-client.js';
import { accountManagerV2 } from '../../src/cli/lib/auth-manager-v2.js';

jest.mock('../../src/cli/lib/auth-manager-v2.js', () => ({
  accountManagerV2: {
    getAccessToken: jest.fn(),
  },
}));

describe('OpenAIClient', () => {
  let client: OpenAIClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    const mockPayload = {
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'test-account-id',
      },
    };
    const mockToken = `header.${Buffer.from(JSON.stringify(mockPayload)).toString('base64')}.signature`;
    
    (accountManagerV2.getAccessToken as jest.Mock).mockResolvedValue(mockToken);
    
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
        expect.stringContaining('chatgpt.com/backend-api/codex/responses'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'ChatGPT-Account-Id': 'test-account-id',
          }),
        })
      );

      expect(result.id).toBe('chat-123');
      expect(result.choices[0].message.content).toBe('Hello!');
    });

    test('throws error when not authenticated', async () => {
      (accountManagerV2.getAccessToken as jest.Mock).mockResolvedValue(undefined);

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
