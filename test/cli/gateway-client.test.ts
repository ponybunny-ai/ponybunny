import { GatewayClient } from '../../src/cli/lib/gateway-client.js';
import { authManager } from '../../src/cli/lib/auth-manager.js';

jest.mock('../../src/cli/lib/auth-manager.js');

describe('GatewayClient', () => {
  let client: GatewayClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    jest.spyOn(authManager, 'getAccessToken').mockReturnValue('test-token');
    jest.spyOn(authManager, 'getGatewayUrl').mockReturnValue('https://api.test.com');
    
    client = new GatewayClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('chatCompletion', () => {
    test('makes POST request with correct parameters', async () => {
      const mockResponse = {
        id: 'chat-123',
        model: 'gpt-5.2',
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
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/chat/completions',
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
          model: 'gpt-5.2',
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
          model: 'gpt-5.2',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow('API request failed');
    });
  });

  describe('createGoal', () => {
    test('creates goal with correct parameters', async () => {
      const mockGoal = {
        id: 'goal-123',
        title: 'Test Goal',
        description: 'Test description',
        status: 'queued',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGoal,
      });

      const result = await client.createGoal({
        title: 'Test Goal',
        description: 'Test description',
        budget_tokens: 10000,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/goals',
        expect.objectContaining({
          method: 'POST',
        })
      );

      expect(result.id).toBe('goal-123');
      expect(result.title).toBe('Test Goal');
    });
  });

  describe('listGoals', () => {
    test('retrieves list of goals', async () => {
      const mockGoals = [
        {
          id: 'goal-1',
          title: 'Goal 1',
          description: 'Desc 1',
          status: 'active',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'goal-2',
          title: 'Goal 2',
          description: 'Desc 2',
          status: 'completed',
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGoals,
      });

      const result = await client.listGoals();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/goals',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('goal-1');
    });
  });

  describe('getGoal', () => {
    test('retrieves specific goal by ID', async () => {
      const mockGoal = {
        id: 'goal-123',
        title: 'Specific Goal',
        description: 'Goal description',
        status: 'active',
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockGoal,
      });

      const result = await client.getGoal('goal-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/goals/goal-123',
        expect.any(Object)
      );

      expect(result.id).toBe('goal-123');
      expect(result.title).toBe('Specific Goal');
    });
  });
});
