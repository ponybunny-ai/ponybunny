import { MessageWindow, DEFAULT_MESSAGE_WINDOW_CONFIG } from '../../../src/runtime/react/message-window.js';
import type { MessageWindowConfig } from '../../../src/runtime/react/message-window.js';
import type { LLMMessage } from '../../../src/infra/llm/llm-provider.js';
import type { ILLMService } from '../../../src/infra/llm/llm-service.interface.js';
import { NoopLogger } from '../../../src/infra/observability/logger.js';

function createMockLLMService(summaryContent = 'Summary of previous messages'): ILLMService {
  return {
    complete: jest.fn().mockResolvedValue({
      content: summaryContent,
      tokensUsed: 50,
      model: 'mock',
      finishReason: 'stop' as const,
    }),
    completeWithModel: jest.fn().mockResolvedValue({
      content: summaryContent,
      tokensUsed: 50,
      model: 'mock',
      finishReason: 'stop' as const,
    }),
    getProviderHealth: jest.fn().mockReturnValue([]),
  };
}

function makeMessage(role: LLMMessage['role'], content: string): LLMMessage {
  return { role, content };
}

function makeLargeMessage(role: LLMMessage['role'], charCount: number): LLMMessage {
  return { role, content: 'x'.repeat(charCount) };
}

const logger = new NoopLogger();

describe('MessageWindow', () => {
  describe('push() and getMessages()', () => {
    it('adds messages and returns them in order', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow({}, llm, logger);

      await mw.push(makeMessage('system', 'You are helpful'));
      await mw.push(makeMessage('user', 'Hello'));
      await mw.push(makeMessage('assistant', 'Hi there'));

      const msgs = mw.getMessages();
      expect(msgs).toHaveLength(3);
      expect(msgs[0].role).toBe('system');
      expect(msgs[1].role).toBe('user');
      expect(msgs[2].role).toBe('assistant');
    });

    it('returns a defensive copy', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow({}, llm, logger);

      await mw.push(makeMessage('user', 'Hello'));
      const msgs = mw.getMessages();
      msgs.push(makeMessage('user', 'injected'));

      expect(mw.getMessages()).toHaveLength(1);
    });
  });

  describe('getEstimatedTokens()', () => {
    it('updates token count after push', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow({}, llm, logger);

      expect(mw.getEstimatedTokens()).toBe(0);

      await mw.push(makeMessage('user', 'Hello'));
      expect(mw.getEstimatedTokens()).toBeGreaterThan(0);
    });
  });

  describe('estimateTokens()', () => {
    it('returns reasonable estimate based on content length', () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow({}, llm, logger);

      // 400 chars / 4 = 100 + 10 overhead = 110
      const msg = makeLargeMessage('user', 400);
      expect(mw.estimateTokens(msg)).toBe(110);
    });

    it('accounts for tool_calls', () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow({}, llm, logger);

      const msg: LLMMessage = {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"/foo"}' },
          },
        ],
      };

      const tokens = mw.estimateTokens(msg);
      // Should include tool call name + arguments length
      expect(tokens).toBeGreaterThan(10);
    });

    it('returns at least 1 for empty messages', () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow({}, llm, logger);

      const msg: LLMMessage = { role: 'assistant', content: null };
      expect(mw.estimateTokens(msg)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('compaction', () => {
    // Use a low threshold so we can trigger compaction easily
    const lowThresholdConfig: Partial<MessageWindowConfig> = {
      summarizeThreshold: 100,
      maxTotalTokens: 200,
      keepSystemPrompt: true,
      keepLastN: 2,
    };

    it('is NOT triggered when below threshold', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow(
        { summarizeThreshold: 100_000 },
        llm,
        logger,
      );

      await mw.push(makeMessage('system', 'system prompt'));
      await mw.push(makeMessage('user', 'short'));

      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('IS triggered when above threshold', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow(lowThresholdConfig, llm, logger);

      await mw.push(makeMessage('system', 'system prompt'));
      await mw.push(makeMessage('user', 'message one'));
      await mw.push(makeMessage('assistant', 'response one'));
      await mw.push(makeMessage('user', 'message two'));
      await mw.push(makeMessage('assistant', 'response two'));
      // Push a large message to cross the threshold
      await mw.push(makeLargeMessage('user', 500));

      expect(llm.complete).toHaveBeenCalled();
    });

    it('preserves system prompt', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow(lowThresholdConfig, llm, logger);

      await mw.push(makeMessage('system', 'You are a helpful assistant'));
      await mw.push(makeMessage('user', 'msg1'));
      await mw.push(makeMessage('assistant', 'resp1'));
      await mw.push(makeMessage('user', 'msg2'));
      await mw.push(makeMessage('assistant', 'resp2'));
      await mw.push(makeLargeMessage('user', 500));

      const msgs = mw.getMessages();
      expect(msgs[0].role).toBe('system');
      expect(msgs[0].content).toBe('You are a helpful assistant');
    });

    it('preserves last N messages', async () => {
      const llm = createMockLLMService();
      const mw = new MessageWindow(
        { ...lowThresholdConfig, keepLastN: 2 },
        llm,
        logger,
      );

      await mw.push(makeMessage('system', 'system'));
      await mw.push(makeMessage('user', 'old1'));
      await mw.push(makeMessage('assistant', 'old2'));
      await mw.push(makeMessage('user', 'recent1'));
      // This large message triggers compaction
      await mw.push(makeLargeMessage('assistant', 500));

      const msgs = mw.getMessages();
      // Last message in the window should be the large one
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.content?.length).toBe(500);

      // Second-to-last should be 'recent1'
      const secondToLast = msgs[msgs.length - 2];
      expect(secondToLast.content).toBe('recent1');
    });

    it('replaces middle messages with summary', async () => {
      const summaryText = 'Condensed summary of conversation';
      const llm = createMockLLMService(summaryText);
      const mw = new MessageWindow(
        { ...lowThresholdConfig, keepLastN: 2 },
        llm,
        logger,
      );

      await mw.push(makeMessage('system', 'system'));
      await mw.push(makeMessage('user', 'old msg 1'));
      await mw.push(makeMessage('assistant', 'old response 1'));
      await mw.push(makeMessage('user', 'old msg 2'));
      await mw.push(makeMessage('assistant', 'old response 2'));
      await mw.push(makeMessage('user', 'recent'));
      await mw.push(makeLargeMessage('assistant', 500));

      const msgs = mw.getMessages();

      // Structure should be: system, summary, last 2
      // (exact count depends on when compaction fires)
      // The summary message should contain our summary text
      const summaryMsg = msgs.find(
        (m) => m.content?.includes('Conversation summary') || m.content?.includes(summaryText),
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg!.content).toContain(summaryText);

      // Total messages should be fewer than original 7
      expect(msgs.length).toBeLessThan(7);
    });

    it('recalculates token estimate after compaction', async () => {
      const llm = createMockLLMService('short summary');
      const mw = new MessageWindow(lowThresholdConfig, llm, logger);

      await mw.push(makeMessage('system', 'system'));
      await mw.push(makeMessage('user', 'msg'));
      await mw.push(makeMessage('assistant', 'resp'));
      const beforePush = mw.getEstimatedTokens();

      // Large message triggers compaction
      await mw.push(makeLargeMessage('user', 500));

      // After compaction with a short summary, tokens should be
      // less than if we had kept everything
      const afterCompaction = mw.getEstimatedTokens();
      // The compacted version should have fewer tokens because
      // the middle was replaced with a short summary
      expect(afterCompaction).toBeLessThan(beforePush + 200);
    });

    it('handles compaction failure gracefully', async () => {
      const llm = createMockLLMService();
      (llm.complete as jest.Mock).mockRejectedValue(new Error('LLM unavailable'));

      const mw = new MessageWindow(lowThresholdConfig, llm, logger);

      await mw.push(makeMessage('system', 'system'));
      await mw.push(makeMessage('user', 'msg1'));
      await mw.push(makeMessage('assistant', 'resp1'));
      await mw.push(makeMessage('user', 'msg2'));

      // Should not throw — compaction failure is logged and skipped
      await mw.push(makeLargeMessage('assistant', 500));

      // All messages should still be present (compaction failed, nothing removed)
      expect(mw.getMessages().length).toBe(5);
    });
  });

  describe('DEFAULT_MESSAGE_WINDOW_CONFIG', () => {
    it('has expected defaults', () => {
      expect(DEFAULT_MESSAGE_WINDOW_CONFIG.maxTotalTokens).toBe(80_000);
      expect(DEFAULT_MESSAGE_WINDOW_CONFIG.keepSystemPrompt).toBe(true);
      expect(DEFAULT_MESSAGE_WINDOW_CONFIG.keepLastN).toBe(4);
      expect(DEFAULT_MESSAGE_WINDOW_CONFIG.summarizeThreshold).toBe(60_000);
    });
  });
});
